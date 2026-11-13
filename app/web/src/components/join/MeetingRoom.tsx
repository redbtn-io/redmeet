'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionQuality,
  RoomEvent,
  Track,
  type Participant,
  type RemoteParticipant,
  type Room,
} from 'livekit-client';
import {
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  PhoneOff,
  Settings2,
  Video,
  VideoOff,
} from 'lucide-react';

import { saveDeviceMemory, type DeviceMemory } from '@/lib/device-memory';
import {
  displacedShareNotice,
  gridLayout,
  pickFallbackDevice,
  resolveDisplayedShare,
  type ShareRef,
} from '@/lib/room-ui';
import { ParticipantTile, type TileView } from './ParticipantTile';

/**
 * The real meeting room (Epic 3). JoinLobby owns getting here:
 * the mint, the connect, and the screens before and after.
 * This component owns everything while the participant is in
 * the room: the grid and tiles (3.1), the mic and camera
 * controls (3.2), device switching without rejoining (3.3),
 * screen share with the shared content layout and takeover
 * (3.4), and connection quality handling (3.5).
 *
 * How the three moving parts work, in one line each:
 * - Active speaker: LiveKit marks isSpeaking on participants
 *   and fires ActiveSpeakersChanged; the tile ring follows
 *   that flag, so the highlight sits on whoever is talking.
 * - Share takeover: every share is stamped with its arrival
 *   order on this client, and the newest one owns the main
 *   area on every client, because every client applies the
 *   same rule; the sharer who lost the main area gets a
 *   short notice.
 * - Reconnect: LiveKit reconnects on its own after a drop
 *   and fires Reconnecting and Reconnected, which drive the
 *   banner here; if it gives up entirely, JoinLobby hears
 *   the final Disconnected and offers the failed screen
 *   with a retry.
 */

export interface MeetingRoomProps {
  room: Room;
  meetingName: string;
  hostName: string;
  initialDevices: DeviceMemory;
  onLeave: () => void;
}

interface ShareView extends ShareRef {
  track: Track | null;
  isLocal: boolean;
}

interface DeviceLists {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
}

interface Toast {
  id: number;
  text: string;
}

type ConnBadge = 'connected' | 'connecting' | 'reconnecting';

const KIND_LABEL = {
  audioinput: 'microphone',
  videoinput: 'camera',
  audiooutput: 'speaker',
} as const;

type DeviceKind = keyof typeof KIND_LABEL;

function ShareStage({ share }: { share: ShareView }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const track = share.track;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  return (
    <div
      data-testid="share-stage"
      data-owner={share.ownerIdentity}
      className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.12)]"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        data-testid="share-video"
        className="h-full w-full object-contain"
      />
      <span className="absolute left-3 top-3 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
        {share.isLocal
          ? 'You are sharing your screen'
          : `${share.ownerName} is sharing their screen`}
      </span>
    </div>
  );
}

export function MeetingRoom(props: MeetingRoomProps) {
  const { room, onLeave } = props;

  const [tiles, setTiles] = useState<TileView[]>([]);
  const [shares, setShares] = useState<ShareView[]>([]);
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [localSharing, setLocalSharing] = useState(false);
  const [connBadge, setConnBadge] = useState<ConnBadge>('connected');
  const [localPoor, setLocalPoor] = useState(false);
  const [camPausedNotice, setCamPausedNotice] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [deviceLists, setDeviceLists] = useState<DeviceLists>({
    mics: [],
    cams: [],
    speakers: [],
  });
  const [micId, setMicId] = useState(props.initialDevices.micId);
  const [camId, setCamId] = useState(props.initialDevices.camId);
  const [speakerId, setSpeakerId] = useState(props.initialDevices.speakerId);

  const audioBoxRef = useRef<HTMLDivElement | null>(null);
  const shareSeqRef = useRef(new Map<string, number>());
  const shareCounterRef = useRef(0);
  const droppedRef = useRef(new Set<string>());
  const autoPausedRef = useRef(false);
  const enumeratedRef = useRef(false);
  const activeIdsRef = useRef<DeviceMemory>(props.initialDevices);
  const toastCounterRef = useRef(0);
  const prevDisplayedSidRef = useRef<string | null>(null);

  const pushToast = useCallback((text: string) => {
    const id = ++toastCounterRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, text }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 7000);
  }, []);

  const persistDevices = useCallback((next: DeviceMemory) => {
    activeIdsRef.current = next;
    saveDeviceMemory(next);
  }, []);

  /**
   * Rebuild the tile and share views from the room as it is
   * right now. Every room event funnels into this, so the UI
   * is always a picture of the room, never a guess about it.
   */
  const sync = useCallback(() => {
    const buildView = (p: Participant, isLocal: boolean): TileView => {
      let videoTrack: Track | null = null;
      let micMuted = true;
      p.videoTrackPublications.forEach((pub) => {
        if (pub.source === Track.Source.Camera) {
          if (pub.track && !pub.isMuted) videoTrack = pub.track;
        }
      });
      p.audioTrackPublications.forEach((pub) => {
        if (pub.source === Track.Source.Microphone) {
          micMuted = pub.isMuted || !pub.track;
        }
      });
      const poor =
        p.connectionQuality === ConnectionQuality.Poor ||
        p.connectionQuality === ConnectionQuality.Lost;
      return {
        identity: p.identity,
        name: p.name || p.identity,
        isLocal,
        isSpeaking: p.isSpeaking,
        micMuted,
        videoTrack,
        poorConnection: poor,
        audioOnly: !isLocal && droppedRef.current.has(p.identity),
      };
    };

    const nextTiles: TileView[] = [buildView(room.localParticipant, true)];
    room.remoteParticipants.forEach((p) => {
      nextTiles.push(buildView(p, false));
    });
    setTiles(nextTiles);
    setMicEnabled(room.localParticipant.isMicrophoneEnabled);
    setCamEnabled(room.localParticipant.isCameraEnabled);
    setLocalSharing(room.localParticipant.isScreenShareEnabled);

    // Shares: stamp arrival order the first time a share is
    // seen, forget it when it ends. The displayed share is
    // resolved from these stamps on every render.
    const seen = new Set<string>();
    const nextShares: ShareView[] = [];
    const collect = (p: Participant, isLocal: boolean) => {
      p.videoTrackPublications.forEach((pub) => {
        if (pub.source !== Track.Source.ScreenShare) return;
        seen.add(pub.trackSid);
        if (!shareSeqRef.current.has(pub.trackSid)) {
          shareSeqRef.current.set(pub.trackSid, ++shareCounterRef.current);
        }
        nextShares.push({
          trackSid: pub.trackSid,
          ownerIdentity: p.identity,
          ownerName: p.name || p.identity,
          seq: shareSeqRef.current.get(pub.trackSid) ?? 0,
          track: pub.track ?? null,
          isLocal,
        });
      });
    };
    collect(room.localParticipant, true);
    room.remoteParticipants.forEach((p) => collect(p, false));
    shareSeqRef.current.forEach((_, sid) => {
      if (!seen.has(sid)) shareSeqRef.current.delete(sid);
    });
    nextShares.sort((a, b) => a.seq - b.seq);
    setShares(nextShares);
  }, [room]);

  const switchDevice = useCallback(
    async (kind: DeviceKind, id: string, opts?: { quiet?: boolean }) => {
      try {
        await room.switchActiveDevice(kind, id || 'default');
      } catch {
        if (!opts?.quiet) {
          pushToast(
            `Could not switch your ${KIND_LABEL[kind]}. The one you were using is still on.`,
          );
        }
        return false;
      }
      const next = { ...activeIdsRef.current };
      if (kind === 'audioinput') {
        next.micId = id;
        setMicId(id);
      } else if (kind === 'videoinput') {
        next.camId = id;
        setCamId(id);
      } else {
        next.speakerId = id;
        setSpeakerId(id);
      }
      persistDevices(next);
      return true;
    },
    [room, persistDevices, pushToast],
  );

  const refreshInFlightRef = useRef(false);
  const refreshDevices = useCallback(async () => {
    // Both the browser devicechange event and LiveKit's own
    // device event can fire for one unplug; one refresh at a
    // time keeps the fallback (and its notice) singular.
    if (refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    try {
      await refreshDevicesInner();
    } finally {
      refreshInFlightRef.current = false;
    }
  }, []);

  const refreshDevicesInner = useCallback(async () => {
    let lists: DeviceLists;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      lists = {
        mics: devices.filter((d) => d.kind === 'audioinput'),
        cams: devices.filter((d) => d.kind === 'videoinput'),
        speakers: devices.filter((d) => d.kind === 'audiooutput'),
      };
    } catch {
      return;
    }
    setDeviceLists(lists);
    if (!enumeratedRef.current) {
      enumeratedRef.current = true;
      return;
    }
    // A device that was in use is gone from the list: fall
    // back to the next available one and say so (story 3.3.2).
    const active = activeIdsRef.current;
    const checks: Array<[DeviceKind, string, MediaDeviceInfo[]]> = [
      ['audioinput', active.micId, lists.mics],
      ['videoinput', active.camId, lists.cams],
      ['audiooutput', active.speakerId, lists.speakers],
    ];
    for (const [kind, activeId, available] of checks) {
      const fallback = pickFallbackDevice(activeId, available);
      if (fallback) {
        const ok = await switchDevice(kind, fallback.deviceId, {
          quiet: true,
        });
        if (ok) {
          pushToast(
            `Your ${KIND_LABEL[kind]} was unplugged, so we switched to ${fallback.label || 'the next available device'}.`,
          );
        }
      }
    }
  }, [switchDevice, pushToast]);

  useEffect(() => {
    const onSync = () => sync();
    const onTrackSubscribed = (track: Track) => {
      if (track.kind === Track.Kind.Audio && audioBoxRef.current) {
        audioBoxRef.current.appendChild(track.attach());
      }
      sync();
    };
    const onTrackUnsubscribed = (track: Track) => {
      track.detach().forEach((el) => el.remove());
      sync();
    };
    const onConnState = () => {
      const state = room.state;
      setConnBadge(
        state === 'connected'
          ? 'connected'
          : state === 'connecting'
            ? 'connecting'
            : 'reconnecting',
      );
    };
    const onQuality = (quality: ConnectionQuality, p: Participant) => {
      if (p.isLocal) {
        const poor = quality === ConnectionQuality.Poor;
        setLocalPoor(poor || quality === ConnectionQuality.Lost);
        if (poor && !autoPausedRef.current) {
          autoPausedRef.current = true;
          if (room.localParticipant.isCameraEnabled) {
            void room.localParticipant
              .setCameraEnabled(false)
              .catch(() => undefined);
            setCamPausedNotice(true);
          }
        }
        if (
          quality === ConnectionQuality.Good ||
          quality === ConnectionQuality.Excellent
        ) {
          autoPausedRef.current = false;
        }
      } else {
        const remote = p as RemoteParticipant;
        const camPub = remote.getTrackPublication(Track.Source.Camera);
        if (
          quality === ConnectionQuality.Poor &&
          camPub &&
          camPub.isSubscribed &&
          camPub.track
        ) {
          camPub.setSubscribed(false);
          droppedRef.current.add(p.identity);
          pushToast(
            `${p.name || 'A participant'} has a poor connection, so you are hearing them without video for now.`,
          );
        } else if (
          (quality === ConnectionQuality.Good ||
            quality === ConnectionQuality.Excellent) &&
          droppedRef.current.has(p.identity)
        ) {
          droppedRef.current.delete(p.identity);
          camPub?.setSubscribed(true);
        }
      }
      sync();
    };
    const onDevicesChanged = () => {
      void refreshDevices();
    };

    room.on(RoomEvent.ParticipantConnected, onSync);
    room.on(RoomEvent.ParticipantDisconnected, onSync);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
    // A remote unpublish (a stopped screen share above all)
    // does not always surface as a room level unsubscribe by
    // the time the picture must change, so publish and
    // unpublish events rebuild the picture too.
    room.on(RoomEvent.TrackPublished, onSync);
    room.on(RoomEvent.TrackUnpublished, onSync);
    room.on(RoomEvent.TrackMuted, onSync);
    room.on(RoomEvent.TrackUnmuted, onSync);
    room.on(RoomEvent.LocalTrackPublished, onSync);
    room.on(RoomEvent.LocalTrackUnpublished, onSync);
    room.on(RoomEvent.ActiveSpeakersChanged, onSync);
    room.on(RoomEvent.ConnectionQualityChanged, onQuality);
    room.on(RoomEvent.ConnectionStateChanged, onConnState);
    room.on(RoomEvent.MediaDevicesChanged, onDevicesChanged);
    navigator.mediaDevices?.addEventListener?.(
      'devicechange',
      onDevicesChanged,
    );

    onConnState();
    sync();
    void refreshDevices();

    return () => {
      room.off(RoomEvent.ParticipantConnected, onSync);
      room.off(RoomEvent.ParticipantDisconnected, onSync);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      room.off(RoomEvent.TrackPublished, onSync);
      room.off(RoomEvent.TrackUnpublished, onSync);
      room.off(RoomEvent.TrackMuted, onSync);
      room.off(RoomEvent.TrackUnmuted, onSync);
      room.off(RoomEvent.LocalTrackPublished, onSync);
      room.off(RoomEvent.LocalTrackUnpublished, onSync);
      room.off(RoomEvent.ActiveSpeakersChanged, onSync);
      room.off(RoomEvent.ConnectionQualityChanged, onQuality);
      room.off(RoomEvent.ConnectionStateChanged, onConnState);
      room.off(RoomEvent.MediaDevicesChanged, onDevicesChanged);
      navigator.mediaDevices?.removeEventListener?.(
        'devicechange',
        onDevicesChanged,
      );
    };
  }, [room, sync, refreshDevices, pushToast]);

  // The takeover notice: when the displayed share changes and
  // it is no longer ours while ours is still live, we lost
  // the main area to a newer share (story 3.4.4).
  const displayedRef = resolveDisplayedShare(shares);
  const displayedShare: ShareView | null = displayedRef
    ? (shares.find((s) => s.trackSid === displayedRef.trackSid) ?? null)
    : null;
  useEffect(() => {
    const prevSid = prevDisplayedSidRef.current;
    if (
      displayedShare &&
      prevSid &&
      displayedShare.trackSid !== prevSid &&
      prevSid ===
        shares.find(
          (s) => s.ownerIdentity === room.localParticipant.identity,
        )?.trackSid
    ) {
      const notice = displacedShareNotice(
        shares,
        displayedShare,
        room.localParticipant.identity,
      );
      if (notice) pushToast(notice);
    }
    prevDisplayedSidRef.current = displayedShare?.trackSid ?? null;
  }, [displayedShare, shares, room, pushToast]);

  async function toggleMic() {
    try {
      await room.localParticipant.setMicrophoneEnabled(!micEnabled);
    } catch {
      pushToast(
        'Could not change your microphone. Check that the browser still has permission to use it.',
      );
    }
    sync();
  }

  async function toggleCamera() {
    setCamPausedNotice(false);
    try {
      await room.localParticipant.setCameraEnabled(!camEnabled);
    } catch {
      pushToast(
        'Could not change your camera. Check that the browser still has permission to use it.',
      );
    }
    sync();
  }

  async function toggleShare() {
    if (localSharing) {
      try {
        await room.localParticipant.setScreenShareEnabled(false);
      } catch {
        // Already stopped is the state we wanted anyway.
      }
      sync();
      return;
    }
    try {
      await room.localParticipant.setScreenShareEnabled(true);
    } catch {
      pushToast(
        'Screen sharing did not start. If you closed the picker, that is fine, nothing was shared.',
      );
    }
    sync();
  }

  const layout = gridLayout(tiles.length);
  const deviceLabel = (d: MediaDeviceInfo, kind: string, i: number) =>
    d.label || `${kind} ${i + 1}`;

  const badgeText =
    connBadge === 'connected'
      ? localPoor
        ? 'Connected, poor connection'
        : 'Connected'
      : connBadge === 'connecting'
        ? 'Connecting...'
        : 'Reconnecting...';

  const tileGrid = (compact: boolean) =>
    tiles.map((tile) => (
      <div
        key={tile.identity}
        className={compact ? 'w-36 shrink-0 sm:w-44' : 'min-w-0'}
      >
        <ParticipantTile view={tile} compact={compact} />
      </div>
    ));

  return (
    <div
      className="relative left-1/2 w-[min(72rem,calc(100vw-3rem))] -translate-x-1/2 rounded-2xl border border-border bg-bg-secondary p-4 sm:p-6"
      data-testid="meeting-room"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">
            {props.meetingName}
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            with {props.hostName}, {tiles.length}{' '}
            {tiles.length === 1 ? 'person' : 'people'} in the meeting
          </p>
        </div>
        <span
          className="rounded-full bg-black/25 px-3 py-1 text-xs font-medium"
          data-testid="connected-badge"
        >
          {badgeText}
        </span>
      </div>

      {connBadge === 'reconnecting' && (
        <p
          className="mt-4 rounded-lg border border-amber-400/40 px-3 py-2 text-sm text-text-secondary"
          data-testid="reconnecting-banner"
          role="status"
        >
          Your connection dropped. Reconnecting now, you will be back in the
          meeting in a moment, stay on this page.
        </p>
      )}

      {camPausedNotice && (
        <div
          className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-400/40 px-3 py-2"
          data-testid="camera-paused-notice"
          role="status"
        >
          <p className="text-sm text-text-secondary">
            Your connection is slow, so your camera was turned off to keep
            your audio clear.
          </p>
          <button
            type="button"
            data-testid="camera-back-on"
            onClick={() => void toggleCamera()}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:text-text-primary"
          >
            Turn camera back on
          </button>
          <button
            type="button"
            onClick={() => setCamPausedNotice(false)}
            className="rounded-lg px-2 py-1.5 text-sm text-text-secondary transition hover:text-text-primary"
          >
            Dismiss
          </button>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="mt-4 space-y-2" aria-live="polite">
          {toasts.map((toast) => (
            <p
              key={toast.id}
              data-testid="room-toast"
              className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary"
            >
              {toast.text}
            </p>
          ))}
        </div>
      )}

      <div className="mt-5">
        {displayedShare ? (
          <div>
            <ShareStage share={displayedShare} />
            <div
              className="mt-3 flex gap-3 overflow-x-auto pb-1"
              data-testid="tile-strip"
            >
              {tileGrid(true)}
            </div>
          </div>
        ) : (
          <div
            className="grid gap-3"
            data-testid="room-grid"
            style={{
              gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            }}
          >
            {tileGrid(false)}
          </div>
        )}
      </div>

      <div
        className="mt-5 flex flex-wrap items-center gap-2"
        data-testid="room-controls"
      >
        <button
          type="button"
          data-testid="room-mic-toggle"
          aria-pressed={micEnabled}
          aria-label={micEnabled ? 'Mute your microphone' : 'Unmute your microphone'}
          onClick={() => void toggleMic()}
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition ${
            micEnabled ? 'bg-black/40 hover:bg-black/60' : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          {micEnabled ? (
            <Mic className="h-4 w-4" aria-hidden />
          ) : (
            <MicOff className="h-4 w-4" aria-hidden />
          )}
          {micEnabled ? 'Mute' : 'Unmute'}
        </button>

        <button
          type="button"
          data-testid="room-camera-toggle"
          aria-pressed={camEnabled}
          aria-label={camEnabled ? 'Turn your camera off' : 'Turn your camera on'}
          onClick={() => void toggleCamera()}
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition ${
            camEnabled ? 'bg-black/40 hover:bg-black/60' : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          {camEnabled ? (
            <Video className="h-4 w-4" aria-hidden />
          ) : (
            <VideoOff className="h-4 w-4" aria-hidden />
          )}
          {camEnabled ? 'Camera on' : 'Camera off'}
        </button>

        <button
          type="button"
          data-testid="room-share-toggle"
          aria-pressed={localSharing}
          aria-label={localSharing ? 'Stop sharing your screen' : 'Share your screen'}
          onClick={() => void toggleShare()}
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition ${
            localSharing
              ? 'bg-[var(--primary-color)] hover:opacity-90'
              : 'bg-black/40 hover:bg-black/60'
          }`}
        >
          {localSharing ? (
            <MonitorX className="h-4 w-4" aria-hidden />
          ) : (
            <MonitorUp className="h-4 w-4" aria-hidden />
          )}
          {localSharing ? 'Stop sharing' : 'Share screen'}
        </button>

        <button
          type="button"
          data-testid="room-devices-toggle"
          aria-expanded={devicesOpen}
          aria-label="Choose microphone, camera, and speaker"
          onClick={() => setDevicesOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-black/40 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black/60"
        >
          <Settings2 className="h-4 w-4" aria-hidden />
          Devices
        </button>

        <button
          type="button"
          data-testid="leave-button"
          aria-label="Leave the meeting"
          onClick={onLeave}
          className="ml-auto flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500"
        >
          <PhoneOff className="h-4 w-4" aria-hidden />
          Leave
        </button>
      </div>

      {devicesOpen && (
        <div
          className="mt-4 grid gap-3 sm:grid-cols-3"
          data-testid="room-devices"
        >
          <label className="block text-sm">
            <span className="text-text-secondary">Microphone</span>
            <select
              data-testid="room-device-mic"
              aria-label="Microphone"
              value={micId}
              onChange={(e) =>
                void switchDevice('audioinput', e.target.value)
              }
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
            >
              <option value="">Browser default</option>
              {deviceLists.mics.map((d, i) => (
                <option key={d.deviceId || `mic-${i}`} value={d.deviceId}>
                  {deviceLabel(d, 'Microphone', i)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-text-secondary">Camera</span>
            <select
              data-testid="room-device-camera"
              aria-label="Camera"
              value={camId}
              onChange={(e) =>
                void switchDevice('videoinput', e.target.value)
              }
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
            >
              <option value="">Browser default</option>
              {deviceLists.cams.map((d, i) => (
                <option key={d.deviceId || `cam-${i}`} value={d.deviceId}>
                  {deviceLabel(d, 'Camera', i)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="text-text-secondary">Speaker</span>
            <select
              data-testid="room-device-speaker"
              aria-label="Speaker"
              value={speakerId}
              onChange={(e) =>
                void switchDevice('audiooutput', e.target.value)
              }
              className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
            >
              <option value="">Browser default</option>
              {deviceLists.speakers.map((d, i) => (
                <option key={d.deviceId || `spk-${i}`} value={d.deviceId}>
                  {deviceLabel(d, 'Speaker', i)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div ref={audioBoxRef} className="hidden" aria-hidden />
    </div>
  );
}
