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
  Users,
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
 *
 * Host controls (Epic 4, features 4.1 to 4.3): the People
 * panel lists every participant with their role (host or
 * guest, from the identity prefix) and their mic and camera
 * state. The host's buttons in it, and the Mute all and End
 * meeting buttons beside Leave, call the host gated moderate
 * endpoint, which performs the LiveKit server API action;
 * nothing in this component enforces anything by itself, it
 * only asks. A guest the host muted sees a notice with their
 * own way back in, because a server side mute leaves the
 * normal publish path open, so unmuting republishes. The
 * host also gets the waiting room panel here: when a guest
 * asks to join a waiting room meeting, their name appears
 * with Admit and Deny, polled from the host gated waiting
 * endpoint. Mute all and End meeting both take a confirm
 * step before anything is sent.
 */

export interface MeetingRoomProps {
  room: Room;
  /** The booking this room belongs to (Epic 4 moderation endpoints). */
  bookingId: string;
  /** True when the local participant is the booking's host. */
  isHost: boolean;
  /**
   * The guest's join token (Epic 6): guests poll the public
   * join-info endpoint with it for server driven room state
   * (the recording indicator above all). Null for the host,
   * whose poll is the session gated waiting endpoint.
   */
  guestToken: string | null;
  meetingName: string;
  hostName: string;
  initialDevices: DeviceMemory;
  onLeave: () => void;
  /** The host ended the meeting; JoinLobby owns the ended screen. */
  onEnded: () => void;
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

/** mm:ss for the recording clock. */
function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

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
  // Epic 4 host controls.
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [hostMuted, setHostMuted] = useState(false);
  const [confirmMuteAll, setConfirmMuteAll] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [waitingGuest, setWaitingGuest] = useState<{ name: string } | null>(null);
  // Epic 6 recording: the state is the SERVER's (polled from
  // the booking), never this client's guess, so every
  // participant's indicator agrees and a late joiner sees
  // recording is on from their first poll.
  const [recordingStatus, setRecordingStatus] = useState<
    'idle' | 'recording' | 'processing' | 'ready' | 'failed'
  >('idle');
  const [recordingStartedAt, setRecordingStartedAt] = useState<string | null>(null);
  const [recordingAnnouncement, setRecordingAnnouncement] = useState(false);
  const [confirmRecord, setConfirmRecord] = useState(false);
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordElapsed, setRecordElapsed] = useState(0);
  const announcedStartRef = useRef<string | null>(null);
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
  // The participant's own microphone intent (Epic 4): the
  // last state THEY asked for. LiveKit reports a server side
  // host mute exactly like a self mute (the local publication
  // is muted and isMicrophoneEnabled reads false), so the
  // only honest way to tell "the host muted you" from "you
  // muted yourself" is whose intent changed last. It starts
  // from the state the room was entered with.
  const micIntentRef = useRef(room.localParticipant.isMicrophoneEnabled);

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
    // Host mute detection (Epic 4): the local microphone
    // publication is muted while the participant's own intent
    // is still live. A self mute sets the intent off in
    // toggleMic before it mutes, so it never trips this.
    let localMicMuted = false;
    room.localParticipant.audioTrackPublications.forEach((pub) => {
      if (pub.source === Track.Source.Microphone) {
        localMicMuted = pub.isMuted;
      }
    });
    setHostMuted(micIntentRef.current && localMicMuted);

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
    const target = !micEnabled;
    micIntentRef.current = target;
    try {
      await room.localParticipant.setMicrophoneEnabled(target);
    } catch {
      pushToast(
        'Could not change your microphone. Check that the browser still has permission to use it.',
      );
    }
    sync();
  }

  /**
   * Back in after a host mute (Epic 4): the track was never
   * unpublished, only muted on the server, so the normal
   * publish path unmutes it.
   */
  async function unmuteAfterHostMute() {
    micIntentRef.current = true;
    try {
      await room.localParticipant.setMicrophoneEnabled(true);
      pushToast('You are unmuted');
    } catch {
      pushToast(
        'Could not unmute you. Check that the browser still has permission to use your microphone.',
      );
    }
    sync();
  }

  /**
   * One moderation ask (Epic 4). The endpoint is host gated
   * and owner scoped server side; this only carries the
   * action and surfaces the answer in words.
   */
  const moderate = useCallback(
    async (
      action: 'mute' | 'mute_all' | 'remove' | 'end' | 'admit' | 'deny',
      identity?: string,
    ): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch(`/api/v0/bookings/${props.bookingId}/moderate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, identity }),
        });
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) {
          pushToast(
            typeof data.error === 'string'
              ? data.error
              : 'That did not work. Try again.',
          );
          return null;
        }
        return data;
      } catch {
        pushToast('That did not work. Check your connection and try again.');
        return null;
      }
    },
    [props.bookingId, pushToast],
  );

  // The host's waiting room view (feature 4.3): poll the host
  // gated waiting endpoint while in the room. One guest per
  // booking means at most one name here. Epic 6: the same
  // poll carries the recording state for the host's room.
  useEffect(() => {
    if (!props.isHost) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/v0/bookings/${props.bookingId}/waiting`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          admission?: { state: string; name: string } | null;
          recording?: { status: string; startedAt: string | null };
        };
        if (cancelled) return;
        setWaitingGuest(
          data.admission?.state === 'waiting' ? { name: data.admission.name } : null,
        );
        if (data.recording) applyRecordingState(data.recording);
      } catch {
        // Polling is best effort; the next round retries.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isHost, props.bookingId]);

  /**
   * One recording state read (Epic 6): adopt the server's
   * state, and when recording is on and this participant has
   * not been told about THIS recording yet (its start time
   * is the identity), raise the announcement. A late joiner's
   * first read announces too: consent is visible, not buried,
   * for everyone, whenever they arrived.
   */
  function applyRecordingState(next: { status: string; startedAt: string | null }) {
    const status = next.status as typeof recordingStatus;
    setRecordingStatus(status);
    setRecordingStartedAt(next.startedAt);
    if (status === 'recording' && next.startedAt && announcedStartRef.current !== next.startedAt) {
      announcedStartRef.current = next.startedAt;
      setRecordingAnnouncement(true);
    }
  }

  // The guest's recording state (Epic 6): guests hold no
  // session, so their poll is the public join-info endpoint
  // with the join token, the same credential that got them
  // into the room. It returns the recording state and nothing
  // about the file (story 6.2.2).
  useEffect(() => {
    if (props.isHost || !props.guestToken) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/public/bookings/${props.bookingId}/join-info?t=${encodeURIComponent(props.guestToken!)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as {
          recording?: { status: string; startedAt: string | null };
        };
        if (cancelled || !data.recording) return;
        applyRecordingState(data.recording);
      } catch {
        // Polling is best effort; the next round retries.
      }
    };
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.isHost, props.bookingId, props.guestToken]);

  // The recording clock: elapsed time since the server said
  // recording started, ticked locally for display.
  useEffect(() => {
    if (recordingStatus !== 'recording' || !recordingStartedAt) {
      setRecordElapsed(0);
      return;
    }
    const started = new Date(recordingStartedAt).getTime();
    const tick = () => setRecordElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [recordingStatus, recordingStartedAt]);

  /**
   * One recording ask (Epic 6). The endpoint is host gated
   * and performs the Egress call server side; this surfaces
   * the answer in words, including the capacity refusal,
   * which arrives as a plain message by design.
   */
  const recordAction = useCallback(
    async (action: 'start' | 'stop'): Promise<boolean> => {
      setRecordBusy(true);
      try {
        const res = await fetch(`/api/v0/bookings/${props.bookingId}/record`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          recording?: { status: string; startedAt: string | null };
        };
        if (!res.ok) {
          pushToast(
            typeof data.error === 'string' ? data.error : 'That did not work. Try again.',
          );
          return false;
        }
        if (data.recording) applyRecordingState(data.recording);
        pushToast(
          action === 'start'
            ? 'Recording started. Everyone in the meeting can see that recording is on.'
            : 'Recording stopped. It will appear on the booking in your dashboard when it is ready.',
        );
        return true;
      } catch {
        pushToast('That did not work. Check your connection and try again.');
        return false;
      } finally {
        setRecordBusy(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [props.bookingId, pushToast],
  );

  async function muteAll() {
    const data = await moderate('mute_all');
    setConfirmMuteAll(false);
    if (!data) return;
    const count = typeof data.mutedCount === 'number' ? data.mutedCount : 0;
    pushToast(
      count > 0
        ? `Muted ${count} microphone${count === 1 ? '' : 's'}`
        : 'Everyone else is already muted',
    );
    sync();
  }

  async function endMeeting() {
    const data = await moderate('end');
    setConfirmEnd(false);
    if (!data) return;
    props.onEnded();
  }

  const roleFor = (tile: TileView): string =>
    tile.isLocal ? 'You' : tile.identity.startsWith('host-') ? 'Host' : 'Guest';

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
        <div className="flex items-center gap-2">
          {recordingStatus === 'recording' && (
            <span
              className="flex items-center gap-2 rounded-full bg-red-600/20 px-3 py-1 text-xs font-medium text-red-300"
              data-testid="recording-indicator"
              role="status"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
              </span>
              Recording {formatElapsed(recordElapsed)}
            </span>
          )}
          <span
            className="rounded-full bg-black/25 px-3 py-1 text-xs font-medium"
            data-testid="connected-badge"
          >
            {badgeText}
          </span>
        </div>
      </div>

      {recordingAnnouncement && recordingStatus === 'recording' && (
        <div
          className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-red-500/50 px-3 py-2"
          data-testid="recording-announcement"
          role="status"
        >
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">This meeting is being recorded.</span>{' '}
            Recording is on, and everyone in the meeting can see it. The recording belongs to
            the host and will sit on the booking in their dashboard.
          </p>
          <button
            type="button"
            onClick={() => setRecordingAnnouncement(false)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:text-text-primary"
          >
            Got it
          </button>
        </div>
      )}

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

      {hostMuted && (
        <div
          className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
          data-testid="host-muted-notice"
          role="status"
        >
          <p className="text-sm text-text-secondary">
            The host muted you. You can unmute yourself whenever you are ready.
          </p>
          <button
            type="button"
            data-testid="host-unmute-button"
            onClick={() => void unmuteAfterHostMute()}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:text-text-primary"
          >
            Unmute
          </button>
        </div>
      )}

      {props.isHost && waitingGuest && (
        <div
          className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2"
          data-testid="waiting-panel"
          role="status"
        >
          <p className="text-sm text-text-secondary">
            <span className="font-medium text-text-primary">{waitingGuest.name}</span>{' '}
            is waiting to join
          </p>
          <button
            type="button"
            data-testid="admit-button"
            onClick={() => {
              void (async () => {
                const data = await moderate('admit');
                if (data) {
                  setWaitingGuest(null);
                  pushToast('Guest admitted');
                }
              })();
            }}
            className="rounded-lg bg-[var(--primary-color)] px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Let them in
          </button>
          <button
            type="button"
            data-testid="deny-button"
            onClick={() => {
              void (async () => {
                const data = await moderate('deny');
                if (data) {
                  setWaitingGuest(null);
                  pushToast('Guest denied');
                }
              })();
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-text-secondary transition hover:text-text-primary"
          >
            Deny
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
          aria-pressed={micEnabled && !hostMuted}
          aria-label={micEnabled ? 'Mute your microphone' : 'Unmute your microphone'}
          onClick={() => void toggleMic()}
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-white transition ${
            micEnabled && !hostMuted ? 'bg-black/40 hover:bg-black/60' : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          {micEnabled && !hostMuted ? (
            <Mic className="h-4 w-4" aria-hidden />
          ) : (
            <MicOff className="h-4 w-4" aria-hidden />
          )}
          {hostMuted ? 'Unmute' : micEnabled ? 'Mute' : 'Unmute'}
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

        {props.isHost && recordingStatus === 'recording' && (
          <button
            type="button"
            data-testid="record-stop-button"
            aria-label="Stop recording"
            disabled={recordBusy}
            onClick={() => void recordAction('stop')}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            <span className="h-2.5 w-2.5 rounded-[3px] bg-white" aria-hidden />
            Stop recording {formatElapsed(recordElapsed)}
          </button>
        )}
        {props.isHost && recordingStatus === 'processing' && (
          <button
            type="button"
            data-testid="record-processing-button"
            disabled
            className="flex items-center gap-2 rounded-lg bg-black/40 px-4 py-2.5 text-sm font-medium text-white opacity-60"
          >
            Recording is finishing...
          </button>
        )}
        {props.isHost &&
          recordingStatus !== 'recording' &&
          recordingStatus !== 'processing' &&
          !confirmRecord && (
            <button
              type="button"
              data-testid="record-start-button"
              aria-label="Start recording this meeting"
              disabled={recordBusy}
              onClick={() => setConfirmRecord(true)}
              className="flex items-center gap-2 rounded-lg bg-black/40 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black/60 disabled:opacity-50"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />
              Record
            </button>
          )}
        {props.isHost && confirmRecord && (
          <>
            <span className="text-sm text-text-secondary">
              Start recording? Everyone will see that recording is on.
            </span>
            <button
              type="button"
              data-testid="record-start-confirm"
              disabled={recordBusy}
              onClick={() => {
                setConfirmRecord(false);
                void recordAction('start');
              }}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              Start recording
            </button>
            <button
              type="button"
              onClick={() => setConfirmRecord(false)}
              className="rounded-lg px-2 py-2 text-sm text-text-secondary transition hover:text-text-primary"
            >
              Cancel
            </button>
          </>
        )}

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
          data-testid="people-toggle"
          aria-expanded={peopleOpen}
          aria-label="See who is in the meeting"
          onClick={() => setPeopleOpen((v) => !v)}
          className="flex items-center gap-2 rounded-lg bg-black/40 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black/60"
        >
          <Users className="h-4 w-4" aria-hidden />
          People ({tiles.length})
        </button>

        {props.isHost && !confirmMuteAll && (
          <button
            type="button"
            data-testid="mute-all-button"
            aria-label="Mute every other participant"
            onClick={() => setConfirmMuteAll(true)}
            className="flex items-center gap-2 rounded-lg bg-black/40 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-black/60"
          >
            <MicOff className="h-4 w-4" aria-hidden />
            Mute all
          </button>
        )}
        {props.isHost && confirmMuteAll && (
          <>
            <span className="text-sm text-text-secondary">Mute every guest?</span>
            <button
              type="button"
              data-testid="mute-all-confirm"
              onClick={() => void muteAll()}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500"
            >
              Mute all
            </button>
            <button
              type="button"
              onClick={() => setConfirmMuteAll(false)}
              className="rounded-lg px-2 py-2 text-sm text-text-secondary transition hover:text-text-primary"
            >
              Cancel
            </button>
          </>
        )}

        {props.isHost && !confirmEnd && (
          <button
            type="button"
            data-testid="end-meeting-button"
            aria-label="End the meeting for everyone"
            onClick={() => setConfirmEnd(true)}
            className="flex items-center gap-2 rounded-lg border border-red-600/60 px-4 py-2.5 text-sm font-medium text-red-400 transition hover:bg-red-600/20"
          >
            <PhoneOff className="h-4 w-4" aria-hidden />
            End meeting
          </button>
        )}
        {props.isHost && confirmEnd && (
          <>
            <span className="text-sm text-text-secondary">
              End the meeting for everyone?
            </span>
            <button
              type="button"
              data-testid="end-meeting-confirm"
              onClick={() => void endMeeting()}
              className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500"
            >
              End meeting
            </button>
            <button
              type="button"
              onClick={() => setConfirmEnd(false)}
              className="rounded-lg px-2 py-2 text-sm text-text-secondary transition hover:text-text-primary"
            >
              Cancel
            </button>
          </>
        )}

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

      {peopleOpen && (
        <div
          className="mt-4 rounded-xl border border-border p-3"
          data-testid="participant-list"
        >
          <p className="text-sm font-medium">People in this meeting</p>
          <ul className="mt-2 space-y-2">
            {tiles.map((tile) => (
              <li
                key={tile.identity}
                data-testid="participant-row"
                data-identity={tile.identity}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="font-medium">{tile.name}</span>
                <span className="rounded-full border border-border px-2 py-0.5 text-xs text-text-secondary">
                  {roleFor(tile)}
                </span>
                <span className="text-xs text-text-secondary">
                  {tile.micMuted ? 'Muted' : 'Mic on'}
                </span>
                <span className="text-xs text-text-secondary">
                  {tile.videoTrack ? 'Camera on' : 'Camera off'}
                </span>
                {props.isHost && !tile.isLocal && (
                  <>
                    {!tile.micMuted && (
                      <button
                        type="button"
                        data-testid="participant-mute"
                        data-identity={tile.identity}
                        onClick={() => {
                          void (async () => {
                            const data = await moderate('mute', tile.identity);
                            if (data) pushToast(`Muted ${tile.name}`);
                            sync();
                          })();
                        }}
                        className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary transition hover:text-text-primary"
                      >
                        Mute
                      </button>
                    )}
                    {confirmRemoveId === tile.identity ? (
                      <>
                        <span className="text-xs text-text-secondary">Remove them?</span>
                        <button
                          type="button"
                          data-testid="participant-remove-confirm"
                          data-identity={tile.identity}
                          onClick={() => {
                            void (async () => {
                              const data = await moderate('remove', tile.identity);
                              setConfirmRemoveId(null);
                              if (data) pushToast(`Removed ${tile.name}`);
                              sync();
                            })();
                          }}
                          className="rounded-lg bg-red-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-red-500"
                        >
                          Remove
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded-lg border border-border px-2 py-1 text-xs text-text-secondary transition hover:text-text-primary"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        data-testid="participant-remove"
                        data-identity={tile.identity}
                        onClick={() => setConfirmRemoveId(tile.identity)}
                        className="rounded-lg border border-red-600/60 px-2 py-1 text-xs text-red-400 transition hover:bg-red-600/20"
                      >
                        Remove
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-text-secondary">
            A guest the host mutes can unmute themselves at any time.
          </p>
        </div>
      )}

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
