'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ConnectionQuality,
  RoomEvent,
  Track,
  type LocalVideoTrack,
  type Participant,
  type RemoteParticipant,
  type Room,
} from 'livekit-client';
import {
  Check,
  ChevronRight,
  Circle,
  Link2,
  Mic,
  MicOff,
  MonitorUp,
  MonitorX,
  MoreVertical,
  PhoneOff,
  Settings2,
  Sparkles,
  Square,
  Users,
  Video,
  VideoOff,
} from 'lucide-react';
import { BottomSheet } from '@redbtn/redlabel/ui/BottomSheet';

import {
  applyBlur,
  blurSupported,
  hasBlur,
  loadBlurPreference,
  saveBlurPreference,
} from '@/lib/background-blur';
import { saveDeviceMemory, type DeviceMemory } from '@/lib/device-memory';
import {
  colorForIdentity,
  displacedShareNotice,
  fitGrid,
  initialsFor,
  pickFallbackDevice,
  resolveDisplayedShare,
  tileAspectFor,
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
 *
 * Layout (the polish pass): the room is a full screen call
 * surface, not a card on a page. A thin top bar carries the
 * meeting name, the recording pill and the connection badge;
 * the stage fills everything between it and a single row of
 * round controls. Two people get the call layout (the other
 * person full stage, you in a corner you can tap to swap);
 * three or more get a best-fit grid measured from the real
 * stage size, so a phone stacks tiles and a laptop lines them
 * up. Notices float over the stage instead of pushing it down.
 * Everything that is not a primary control lives in sheets
 * (redlabel BottomSheet: a bottom sheet on phones, a side
 * drawer on desktop): People, Devices, and More. Confirms
 * are a small dialog, never inline text in the control bar.
 *
 * Background blur: a LiveKit track processor (MediaPipe,
 * self hosted, see lib/background-blur.ts) on the local
 * camera track. The wish is remembered in this browser and
 * re-asserted whenever the camera track is republished, so it
 * survives camera off and on and device switches.
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
  /**
   * The share link for an instant meeting (Epic 8): the host
   * gets an Invite button in the room that copies it. Null for
   * booked meetings and for guests.
   */
  inviteUrl?: string | null;
  meetingName: string;
  hostName: string;
  initialDevices: DeviceMemory;
  /**
   * Something the join itself needs to tell the participant,
   * shown as a toast on arrival (for example: blur could not
   * start, so the camera was left off rather than shown
   * unblurred).
   */
  initialNotice?: string | null;
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
      className="relative h-full w-full overflow-hidden rounded-2xl bg-black shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        data-testid="share-video"
        className="h-full w-full object-contain"
      />
      <span className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
        <MonitorUp className="h-3.5 w-3.5" aria-hidden />
        {share.isLocal
          ? 'You are sharing your screen'
          : `${share.ownerName} is sharing their screen`}
      </span>
    </div>
  );
}

/** One round control in the bottom bar. */
function ControlButton({
  label,
  tone = 'neutral',
  onClick,
  children,
  className = '',
  ...rest
}: {
  label: string;
  tone?: 'neutral' | 'off' | 'active' | 'danger';
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className'>) {
  const tones = {
    neutral: 'bg-white/10 text-white hover:bg-white/20',
    off: 'bg-red-600 text-white hover:bg-red-500',
    active: 'bg-[var(--primary-color)] text-white hover:opacity-90',
    danger: 'bg-red-600 text-white hover:bg-red-500',
  } as const;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition active:scale-95 disabled:opacity-50 ${tones[tone]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** One row in the More sheet: icon, label, optional detail, chevron or state. */
function SheetRow({
  icon,
  label,
  detail,
  onClick,
  danger = false,
  trailing,
  ...rest
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  onClick: () => void;
  danger?: boolean;
  trailing?: React.ReactNode;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-bg-hover disabled:opacity-50 ${
        danger ? 'text-red-400' : 'text-text-primary'
      }`}
      {...rest}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-hover">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {detail && <span className="block text-xs text-text-muted">{detail}</span>}
      </span>
      {trailing ?? <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />}
    </button>
  );
}

/** An on and off switch, for rows that toggle in place. */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-6 w-10 shrink-0 rounded-full transition ${
        on ? 'bg-[var(--primary-color)]' : 'bg-white/15'
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${
          on ? 'left-[1.125rem]' : 'left-0.5'
        }`}
      />
    </span>
  );
}

/** The small confirm dialog for actions that affect everyone. */
function ConfirmDialog({
  title,
  body,
  confirmLabel,
  confirmTestId,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirmTestId: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  // The room re-renders every second while recording (the
  // clock), handing a fresh onCancel each time; a ref keeps
  // this effect to mount only, so focus is set once and stays
  // wherever the user moves it.
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;
  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancelRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-3 sm:items-center">
      <div aria-hidden className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="rm-rise relative w-full max-w-sm rounded-2xl border border-white/10 bg-zinc-900 p-5 text-white shadow-2xl"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1.5 text-sm text-white/70">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-4 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-testid={confirmTestId}
            disabled={busy}
            onClick={onConfirm}
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

type SheetName = 'people' | 'devices' | 'more';

/**
 * redlabel's sheet surface is a translucent overlay token, which over
 * live video lets the picture bleed through the rows. The room's
 * sheets are solid.
 */
const ROOM_SHEET_CLASS = 'bg-zinc-900! border-white/10!';

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
  // Which sheet is open: People, Devices, or More. One at a time.
  const [sheet, setSheet] = useState<SheetName | null>(null);
  // Background blur: the wish (remembered in this browser), and
  // whether this browser can do it at all (hidden when not).
  const [blurOn, setBlurOn] = useState(() => loadBlurPreference());
  const [blurAvailable, setBlurAvailable] = useState(false);
  // Two person call layout: who is in the big frame. False is
  // the other person, true is you (tap the corner to swap).
  const [selfFeatured, setSelfFeatured] = useState(false);
  // The stage box, measured, so the grid fits the real space.
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  // Screen share needs getDisplayMedia, which phones lack.
  const [canShare] = useState(
    () =>
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getDisplayMedia === 'function',
  );
  // Epic 4 host controls.
  const [hostMuted, setHostMuted] = useState(false);
  const [confirmMuteAll, setConfirmMuteAll] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  // Who is waiting to be let in. A booked meeting has at most
  // one (identity null: the decision needs none); an instant
  // meeting (Epic 8) can have several, each decided by their
  // own identity.
  const [waitingGuests, setWaitingGuests] = useState<
    { identity: string | null; name: string }[]
  >([]);
  const [inviteCopied, setInviteCopied] = useState(false);
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
  // gated waiting endpoint while in the room. A booked meeting
  // carries the one guest in `admission`; an instant meeting
  // (Epic 8) carries every waiting guest in `admissions`, each
  // with the identity their decision needs. Epic 6: the same
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
          admissions?: { identity: string; name: string; state: string }[];
          recording?: { status: string; startedAt: string | null };
        };
        if (cancelled) return;
        const fromList = (data.admissions ?? [])
          .filter((a) => a.state === 'waiting')
          .map((a) => ({ identity: a.identity as string | null, name: a.name }));
        if (fromList.length > 0) {
          setWaitingGuests(fromList);
        } else if (data.admission?.state === 'waiting') {
          setWaitingGuests([{ identity: null, name: data.admission.name }]);
        } else {
          setWaitingGuests([]);
        }
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

  // The join's own notice, once, on arrival.
  const initialNoticeRef = useRef(props.initialNotice ?? null);
  useEffect(() => {
    if (initialNoticeRef.current) pushToast(initialNoticeRef.current);
    initialNoticeRef.current = null;
  }, [pushToast]);

  // Can this browser blur at all? Resolved once; the toggle
  // stays hidden where it cannot work.
  useEffect(() => {
    let cancelled = false;
    void blurSupported().then((ok) => {
      if (!cancelled) setBlurAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the camera track's processor in line with the wish.
  // One change at a time; the loop picks up a wish that flipped
  // while a change was in flight. Re-run on every camera
  // republish (camera back on, device switch), so the blur
  // survives them. A processor that fails turns the wish off
  // and says so, never a silently unblurred camera.
  const blurOnRef = useRef(blurOn);
  blurOnRef.current = blurOn;
  const blurWorkingRef = useRef(false);
  const ensureBlur = useCallback(async () => {
    if (blurWorkingRef.current) return;
    blurWorkingRef.current = true;
    try {
      if (!(await blurSupported())) return;
      for (let i = 0; i < 3; i++) {
        const track = room.localParticipant.getTrackPublication(Track.Source.Camera)
          ?.track as LocalVideoTrack | undefined;
        if (!track) return;
        const want = blurOnRef.current;
        if (hasBlur(track) === want) return;
        await applyBlur(track, want);
      }
    } catch {
      setBlurOn(false);
      saveBlurPreference(false);
      pushToast(
        'Background blur could not start on this device, so your camera is showing without it.',
      );
    } finally {
      blurWorkingRef.current = false;
    }
  }, [room, pushToast]);
  useEffect(() => {
    void ensureBlur();
  }, [ensureBlur, blurOn, camEnabled, camId]);

  function toggleBlur() {
    const next = !blurOn;
    setBlurOn(next);
    saveBlurPreference(next);
  }

  // The room is the whole screen while it is up: no page
  // scroll behind it (iOS would otherwise rubber band the call).
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = previous;
    };
  }, []);

  // Measure the stage so the grid fits the space it really has.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setStageSize({ width: Math.round(r.width), height: Math.round(r.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function copyInvite() {
    void navigator.clipboard
      .writeText(props.inviteUrl ?? '')
      .then(() => {
        setInviteCopied(true);
        pushToast('Invite link copied');
        setTimeout(() => setInviteCopied(false), 2000);
      })
      .catch(() => pushToast('Could not copy the invite link'));
  }

  async function decideGuest(
    waiting: { identity: string | null; name: string },
    action: 'admit' | 'deny',
  ) {
    const data = await moderate(action, waiting.identity ?? undefined);
    if (data) {
      setWaitingGuests((list) => list.filter((w) => w.identity !== waiting.identity));
      pushToast(action === 'admit' ? 'Guest admitted' : 'Guest denied');
    }
  }

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
  const badgeHealthy = connBadge === 'connected' && !localPoor;

  const micLive = micEnabled && !hostMuted;
  const portrait = stageSize.height > stageSize.width;
  const localTile = tiles.find((t) => t.isLocal) ?? null;
  const remoteTile = tiles.find((t) => !t.isLocal) ?? null;
  const twoUp = !displayedShare && tiles.length === 2 && localTile && remoteTile;
  const featuredTile = selfFeatured ? localTile : remoteTile;
  const cornerTile = selfFeatured ? remoteTile : localTile;
  const grid = fitGrid(
    tiles.length,
    stageSize.width,
    stageSize.height,
    tileAspectFor(stageSize.width, stageSize.height),
    8,
  );
  const alone = tiles.length === 1;

  const noticeClass =
    'rm-rise pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-white/10 bg-zinc-900/90 px-4 py-3 text-sm text-white shadow-xl backdrop-blur-md';
  const noticeButton =
    'rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/20';
  const selectClass =
    'mt-1 w-full rounded-xl border border-border bg-bg px-3 py-2.5 text-sm text-text-primary';

  return (
    <div
      className="dark fixed inset-0 z-40 flex flex-col bg-[#0b0b0d] text-white"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
      data-testid="meeting-room"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 px-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold sm:text-base">{props.meetingName}</h1>
          <p className="truncate text-xs text-white/55">
            with {props.hostName} · {tiles.length}{' '}
            {tiles.length === 1 ? 'person' : 'people'}
          </p>
        </div>
        {recordingStatus === 'recording' && (
          <span
            className="flex shrink-0 items-center gap-2 rounded-full bg-red-600/20 px-3 py-1 text-xs font-medium text-red-300"
            data-testid="recording-indicator"
            role="status"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
            </span>
            <span className="hidden sm:inline">Recording</span> {formatElapsed(recordElapsed)}
          </span>
        )}
        <span
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium"
          data-testid="connected-badge"
          aria-label={badgeText}
          title={badgeText}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              badgeHealthy ? 'bg-emerald-400' : 'animate-pulse bg-amber-400'
            }`}
          />
          <span className={badgeHealthy ? 'hidden sm:inline' : ''}>{badgeText}</span>
        </span>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col px-2 sm:px-4">
        <div ref={stageRef} className="relative min-h-0 flex-1">
          {displayedShare ? (
            <div className="flex h-full w-full flex-col gap-2 lg:flex-row">
              <div className="min-h-0 min-w-0 flex-1">
                <ShareStage share={displayedShare} />
              </div>
              <div
                className="rm-strip flex h-24 shrink-0 gap-2 overflow-x-auto sm:h-28 lg:h-full lg:w-56 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto"
                data-testid="tile-strip"
              >
                {tiles.map((tile) => (
                  <div
                    key={tile.identity}
                    className="aspect-video h-full shrink-0 lg:h-auto lg:w-full"
                  >
                    <ParticipantTile view={tile} variant="strip" />
                  </div>
                ))}
              </div>
            </div>
          ) : twoUp && featuredTile && cornerTile ? (
            <div className="relative h-full w-full" data-testid="room-grid" data-layout="call">
              <ParticipantTile view={featuredTile} />
              <button
                type="button"
                onClick={() => setSelfFeatured((v) => !v)}
                aria-label={`Swap: show ${selfFeatured ? cornerTile.name : 'yourself'} large`}
                title="Tap to swap"
                className={`absolute bottom-3 right-3 z-10 overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/15 transition hover:ring-white/40 active:scale-[0.98] ${
                  portrait
                    ? 'aspect-[3/4] w-[30%] max-w-[9.5rem]'
                    : 'aspect-video w-[24%] min-w-32 max-w-[16rem]'
                }`}
              >
                <ParticipantTile view={cornerTile} variant="pip" />
              </button>
            </div>
          ) : (
            <div
              className="flex h-full w-full flex-wrap content-center items-center justify-center gap-2"
              data-testid="room-grid"
              data-layout="grid"
            >
              {tiles.map((tile) => (
                <div
                  key={tile.identity}
                  style={{ width: grid.tileWidth, height: grid.tileHeight }}
                  className="shrink-0"
                >
                  <ParticipantTile view={tile} />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notices and toasts float over the top of the stage, so
            nothing ever pushes the video around. */}
        <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex flex-col items-center gap-2 px-3">
          {recordingAnnouncement && recordingStatus === 'recording' && (
            <div className={`${noticeClass} border-red-500/40`} data-testid="recording-announcement" role="status">
              <p className="min-w-0 flex-1 text-white/75">
                <span className="font-medium text-white">This meeting is being recorded.</span>{' '}
                Everyone in the meeting can see it. The recording belongs to the host and will
                sit on the booking in their dashboard.
              </p>
              <button
                type="button"
                onClick={() => setRecordingAnnouncement(false)}
                className={noticeButton}
              >
                Got it
              </button>
            </div>
          )}

          {connBadge === 'reconnecting' && (
            <p
              className={`${noticeClass} border-amber-400/40 text-white/80`}
              data-testid="reconnecting-banner"
              role="status"
            >
              Your connection dropped. Reconnecting now, you will be back in the meeting in a
              moment, stay on this page.
            </p>
          )}

          {camPausedNotice && (
            <div className={`${noticeClass} border-amber-400/40`} data-testid="camera-paused-notice" role="status">
              <p className="min-w-0 flex-1 text-white/80">
                Your connection is slow, so your camera was turned off to keep your audio clear.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  data-testid="camera-back-on"
                  onClick={() => void toggleCamera()}
                  className={noticeButton}
                >
                  Turn camera back on
                </button>
                <button
                  type="button"
                  onClick={() => setCamPausedNotice(false)}
                  className="rounded-full px-2 py-1.5 text-xs text-white/60 transition hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {hostMuted && (
            <div className={noticeClass} data-testid="host-muted-notice" role="status">
              <p className="min-w-0 flex-1 text-white/80">
                The host muted you. You can unmute yourself whenever you are ready.
              </p>
              <button
                type="button"
                data-testid="host-unmute-button"
                onClick={() => void unmuteAfterHostMute()}
                className={noticeButton}
              >
                Unmute
              </button>
            </div>
          )}

          {props.isHost &&
            waitingGuests.map((waiting) => (
              <div
                key={waiting.identity ?? 'the-guest'}
                className={noticeClass}
                data-testid="waiting-panel"
                role="status"
              >
                <p className="min-w-0 flex-1 text-white/80">
                  <span className="font-medium text-white">{waiting.name}</span> is waiting to
                  join
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    data-testid="admit-button"
                    onClick={() => void decideGuest(waiting, 'admit')}
                    className="rounded-full bg-[var(--primary-color)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                  >
                    Let them in
                  </button>
                  <button
                    type="button"
                    data-testid="deny-button"
                    onClick={() => void decideGuest(waiting, 'deny')}
                    className={noticeButton}
                  >
                    Deny
                  </button>
                </div>
              </div>
            ))}

          {alone && connBadge === 'connected' && (
            <div
              className={`${noticeClass} justify-center bg-zinc-900/70 text-center`}
              data-testid="alone-notice"
            >
              <p className="text-white/75">You are the only one here.</p>
              {props.isHost && props.inviteUrl && (
                <button type="button" onClick={copyInvite} className={noticeButton}>
                  {inviteCopied ? 'Link copied' : 'Copy invite link'}
                </button>
              )}
            </div>
          )}

          <div className="flex w-full flex-col items-center gap-2" aria-live="polite">
            {toasts.map((toast) => (
              <p
                key={toast.id}
                data-testid="room-toast"
                className="rm-rise pointer-events-auto w-fit max-w-md rounded-full bg-white/95 px-4 py-2 text-center text-sm font-medium text-zinc-900 shadow-xl"
              >
                {toast.text}
              </p>
            ))}
          </div>
        </div>
      </main>

      <div
        className="flex shrink-0 items-center justify-center gap-2 px-3 pt-3 sm:gap-3"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
        data-testid="room-controls"
      >
        <ControlButton
          data-testid="room-mic-toggle"
          aria-pressed={micLive}
          label={micLive ? 'Mute your microphone' : 'Unmute your microphone'}
          tone={micLive ? 'neutral' : 'off'}
          onClick={() => void toggleMic()}
        >
          {micLive ? <Mic className="h-5 w-5" aria-hidden /> : <MicOff className="h-5 w-5" aria-hidden />}
        </ControlButton>

        <ControlButton
          data-testid="room-camera-toggle"
          aria-pressed={camEnabled}
          label={camEnabled ? 'Turn your camera off' : 'Turn your camera on'}
          tone={camEnabled ? 'neutral' : 'off'}
          onClick={() => void toggleCamera()}
        >
          {camEnabled ? <Video className="h-5 w-5" aria-hidden /> : <VideoOff className="h-5 w-5" aria-hidden />}
        </ControlButton>

        {blurAvailable && (
          <ControlButton
            data-testid="room-blur-toggle"
            aria-pressed={blurOn}
            label={blurOn ? 'Turn background blur off' : 'Blur your background'}
            tone={blurOn ? 'active' : 'neutral'}
            onClick={toggleBlur}
            className="hidden sm:flex"
          >
            <Sparkles className="h-5 w-5" aria-hidden />
          </ControlButton>
        )}

        {canShare && (
          <ControlButton
            data-testid="room-share-toggle"
            aria-pressed={localSharing}
            label={localSharing ? 'Stop sharing your screen' : 'Share your screen'}
            tone={localSharing ? 'active' : 'neutral'}
            onClick={() => void toggleShare()}
          >
            {localSharing ? (
              <MonitorX className="h-5 w-5" aria-hidden />
            ) : (
              <MonitorUp className="h-5 w-5" aria-hidden />
            )}
          </ControlButton>
        )}

        {props.isHost && recordingStatus === 'recording' && (
          <ControlButton
            data-testid="record-stop-button"
            label={`Stop recording (${formatElapsed(recordElapsed)})`}
            tone="danger"
            disabled={recordBusy}
            onClick={() => void recordAction('stop')}
            className="hidden sm:flex"
          >
            <Square className="h-4 w-4 fill-current" aria-hidden />
          </ControlButton>
        )}
        {props.isHost && recordingStatus === 'processing' && (
          <ControlButton
            data-testid="record-processing-button"
            label="Recording is finishing"
            disabled
            onClick={() => undefined}
            className="hidden sm:flex"
          >
            <Circle className="h-4 w-4 animate-pulse fill-current text-red-400" aria-hidden />
          </ControlButton>
        )}
        {props.isHost && recordingStatus !== 'recording' && recordingStatus !== 'processing' && (
          <ControlButton
            data-testid="record-start-button"
            label="Start recording this meeting"
            disabled={recordBusy}
            onClick={() => setConfirmRecord(true)}
            className="hidden sm:flex"
          >
            <Circle className="h-4 w-4 fill-red-500 text-red-500" aria-hidden />
          </ControlButton>
        )}

        <span className="mx-1 hidden h-8 w-px bg-white/10 sm:block" aria-hidden />

        <ControlButton
          data-testid="people-toggle"
          aria-expanded={sheet === 'people'}
          label={`People in the meeting (${tiles.length})`}
          onClick={() => setSheet('people')}
        >
          <Users className="h-5 w-5" aria-hidden />
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-700 px-1 text-[10px] font-semibold ring-2 ring-[#0b0b0d]">
            {tiles.length}
          </span>
          {props.isHost && waitingGuests.length > 0 && (
            <span className="absolute -left-0.5 -top-0.5 h-3 w-3 animate-pulse rounded-full bg-amber-400 ring-2 ring-[#0b0b0d]" />
          )}
        </ControlButton>

        <ControlButton
          data-testid="more-toggle"
          aria-expanded={sheet === 'more'}
          label="More options"
          onClick={() => setSheet('more')}
        >
          <MoreVertical className="h-5 w-5" aria-hidden />
          {props.isHost && recordingStatus === 'recording' && (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-red-500 ring-2 ring-[#0b0b0d] sm:hidden" />
          )}
        </ControlButton>

        <button
          type="button"
          data-testid="leave-button"
          aria-label="Leave the meeting"
          title="Leave the meeting"
          onClick={onLeave}
          className="flex h-12 shrink-0 items-center gap-2 rounded-full bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-500 active:scale-95 sm:px-5"
        >
          <PhoneOff className="h-5 w-5" aria-hidden />
          <span className="hidden sm:inline">Leave</span>
        </button>
      </div>

      <BottomSheet
        open={sheet === 'more'}
        onClose={() => setSheet(null)}
        title="More options"
        className={ROOM_SHEET_CLASS}
      >
        <div className="space-y-1" data-testid="more-sheet">
          {blurAvailable && (
            <SheetRow
              data-testid="more-blur"
              aria-pressed={blurOn}
              icon={<Sparkles className="h-4 w-4" aria-hidden />}
              label="Blur my background"
              detail={blurOn ? 'On. People see you, not your room.' : 'Off'}
              onClick={toggleBlur}
              trailing={<Switch on={blurOn} />}
            />
          )}
          <SheetRow
            data-testid="room-devices-toggle"
            icon={<Settings2 className="h-4 w-4" aria-hidden />}
            label="Devices"
            detail="Microphone, camera, and speaker"
            onClick={() => setSheet('devices')}
          />
          {props.isHost && recordingStatus === 'recording' && (
            <SheetRow
              data-testid="more-record-stop"
              disabled={recordBusy}
              icon={<Square className="h-3.5 w-3.5 fill-red-500 text-red-500" aria-hidden />}
              label="Stop recording"
              detail={`Recording for ${formatElapsed(recordElapsed)}`}
              onClick={() => {
                setSheet(null);
                void recordAction('stop');
              }}
            />
          )}
          {props.isHost && recordingStatus === 'processing' && (
            <SheetRow
              disabled
              icon={<Circle className="h-3.5 w-3.5 animate-pulse fill-red-400 text-red-400" aria-hidden />}
              label="Recording is finishing"
              detail="It will appear on the booking in your dashboard"
              onClick={() => undefined}
              trailing={<span />}
            />
          )}
          {props.isHost && recordingStatus !== 'recording' && recordingStatus !== 'processing' && (
            <SheetRow
              data-testid="more-record"
              disabled={recordBusy}
              icon={<Circle className="h-3.5 w-3.5 fill-red-500 text-red-500" aria-hidden />}
              label="Record this meeting"
              detail="Everyone will see that recording is on"
              onClick={() => {
                setSheet(null);
                setConfirmRecord(true);
              }}
            />
          )}
          {props.isHost && props.inviteUrl && (
            <SheetRow
              data-testid="invite-button"
              icon={<Link2 className="h-4 w-4" aria-hidden />}
              label={inviteCopied ? 'Invite link copied' : 'Copy invite link'}
              detail="Anyone with the link gets their own seat"
              onClick={copyInvite}
              trailing={
                inviteCopied ? <Check className="h-4 w-4 text-emerald-400" aria-hidden /> : undefined
              }
            />
          )}
          {props.isHost && (
            <SheetRow
              data-testid="mute-all-button"
              icon={<MicOff className="h-4 w-4" aria-hidden />}
              label="Mute everyone else"
              detail="Guests can unmute themselves"
              onClick={() => {
                setSheet(null);
                setConfirmMuteAll(true);
              }}
            />
          )}
          {props.isHost && (
            <SheetRow
              data-testid="end-meeting-button"
              danger
              icon={<PhoneOff className="h-4 w-4" aria-hidden />}
              label="End meeting for everyone"
              detail="Disconnects everyone and closes the room"
              onClick={() => {
                setSheet(null);
                setConfirmEnd(true);
              }}
            />
          )}
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === 'people'}
        className={ROOM_SHEET_CLASS}
        onClose={() => setSheet(null)}
        title={`People (${tiles.length})`}
        footer={
          props.isHost && tiles.length > 1 ? (
            <button
              type="button"
              onClick={() => {
                setSheet(null);
                setConfirmMuteAll(true);
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-bg-hover px-4 py-2.5 text-sm font-medium text-text-primary transition hover:bg-border"
            >
              <MicOff className="h-4 w-4" aria-hidden />
              Mute everyone else
            </button>
          ) : undefined
        }
      >
        <div data-testid="participant-list">
          {props.isHost && waitingGuests.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
                Waiting to join
              </p>
              <ul className="space-y-2">
                {waitingGuests.map((waiting) => (
                  <li
                    key={waiting.identity ?? 'the-guest'}
                    className="flex items-center gap-2 rounded-xl bg-bg-hover px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{waiting.name}</span>
                    <button
                      type="button"
                      data-testid="people-admit"
                      onClick={() => void decideGuest(waiting, 'admit')}
                      className="rounded-full bg-[var(--primary-color)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90"
                    >
                      Let in
                    </button>
                    <button
                      type="button"
                      data-testid="people-deny"
                      onClick={() => void decideGuest(waiting, 'deny')}
                      className="rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition hover:text-text-primary"
                    >
                      Deny
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            In the meeting
          </p>
          <ul className="space-y-1">
            {tiles.map((tile) => (
              <li
                key={tile.identity}
                data-testid="participant-row"
                data-identity={tile.identity}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-2 py-2"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white"
                  style={{ backgroundColor: colorForIdentity(tile.identity) }}
                >
                  {initialsFor(tile.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{tile.name}</span>
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] text-text-secondary">
                      {roleFor(tile)}
                    </span>
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                    {tile.micMuted ? (
                      <MicOff className="h-3.5 w-3.5 text-red-400" aria-hidden />
                    ) : (
                      <Mic className="h-3.5 w-3.5" aria-hidden />
                    )}
                    <span>{tile.micMuted ? 'Muted' : 'Mic on'}</span>
                    {tile.videoTrack ? (
                      <Video className="h-3.5 w-3.5" aria-hidden />
                    ) : (
                      <VideoOff className="h-3.5 w-3.5" aria-hidden />
                    )}
                    <span>{tile.videoTrack ? 'Camera on' : 'Camera off'}</span>
                  </span>
                </span>
                {props.isHost && !tile.isLocal && (
                  <span className="flex items-center gap-1.5">
                    {!tile.micMuted && confirmRemoveId !== tile.identity && (
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
                        className="rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition hover:text-text-primary"
                      >
                        Mute
                      </button>
                    )}
                    {confirmRemoveId === tile.identity ? (
                      <>
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
                          className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-500"
                        >
                          Remove them
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary transition hover:text-text-primary"
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
                        className="rounded-full border border-red-600/50 px-3 py-1.5 text-xs text-red-400 transition hover:bg-red-600/15"
                      >
                        Remove
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-text-muted">
            A guest the host mutes can unmute themselves at any time.
          </p>
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === 'devices'}
        className={ROOM_SHEET_CLASS}
        onClose={() => setSheet(null)}
        title="Devices"
        description="Changes apply right away, without rejoining."
      >
        <div className="space-y-4" data-testid="room-devices">
          {blurAvailable && (
            <SheetRow
              data-testid="devices-blur"
              aria-pressed={blurOn}
              icon={<Sparkles className="h-4 w-4" aria-hidden />}
              label="Blur my background"
              detail={blurOn ? 'On' : 'Off'}
              onClick={toggleBlur}
              trailing={<Switch on={blurOn} />}
            />
          )}
          <label className="block text-sm">
            <span className="text-text-secondary">Microphone</span>
            <select
              data-testid="room-device-mic"
              aria-label="Microphone"
              value={micId}
              onChange={(e) => void switchDevice('audioinput', e.target.value)}
              className={selectClass}
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
              onChange={(e) => void switchDevice('videoinput', e.target.value)}
              className={selectClass}
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
              onChange={(e) => void switchDevice('audiooutput', e.target.value)}
              className={selectClass}
            >
              <option value="">Browser default</option>
              {deviceLists.speakers.map((d, i) => (
                <option key={d.deviceId || `spk-${i}`} value={d.deviceId}>
                  {deviceLabel(d, 'Speaker', i)}
                </option>
              ))}
            </select>
            {deviceLists.speakers.length === 0 && (
              <span className="mt-1 block text-xs text-text-muted">
                This browser picks the speaker itself (Safari and Firefox do).
              </span>
            )}
          </label>
        </div>
      </BottomSheet>

      {confirmRecord && (
        <ConfirmDialog
          title="Start recording?"
          body="Everyone in the meeting will see that recording is on. The recording will sit on the booking in your dashboard."
          confirmLabel="Start recording"
          confirmTestId="record-start-confirm"
          busy={recordBusy}
          onConfirm={() => {
            setConfirmRecord(false);
            void recordAction('start');
          }}
          onCancel={() => setConfirmRecord(false)}
        />
      )}
      {confirmMuteAll && (
        <ConfirmDialog
          title="Mute everyone else?"
          body="Every guest's microphone is muted. They can unmute themselves when they need to speak."
          confirmLabel="Mute all"
          confirmTestId="mute-all-confirm"
          onConfirm={() => void muteAll()}
          onCancel={() => setConfirmMuteAll(false)}
        />
      )}
      {confirmEnd && (
        <ConfirmDialog
          title="End the meeting for everyone?"
          body="Everyone is disconnected and the room closes."
          confirmLabel="End meeting"
          confirmTestId="end-meeting-confirm"
          onConfirm={() => void endMeeting()}
          onCancel={() => setConfirmEnd(false)}
        />
      )}

      <div ref={audioBoxRef} className="hidden" aria-hidden />
    </div>
  );
}
