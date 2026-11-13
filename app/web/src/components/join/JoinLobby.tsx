'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent } from 'livekit-client';

import {
  loadDeviceMemory,
  saveDeviceMemory,
} from '@/lib/device-memory';
import { MeetingRoom } from './MeetingRoom';

/**
 * The join flow (Epic 2): lobby, device check, connect, and the
 * room itself.
 *
 * The lobby is story 2.2: meeting name, host, and time up top;
 * the guest's own camera and mic preview with on and off toggles;
 * mic, camera, and speaker pickers listing the browser's real
 * devices; and a permission denied state in plain words with a
 * join audio only or listen only path out of it.
 *
 * Joining mints through the Epic 1 endpoints, and ONLY through
 * them: the guest endpoint with the join token for guests, the
 * session gated owner scoped endpoint for the host. The window
 * (opens 5 minutes before, closes at roomExpiresAt) is enforced
 * at that mint, and the error codes come back here to be turned
 * into plain words.
 *
 * What renders after connect is the real room (Epic 3): the
 * MeetingRoom component owns the grid, the controls, device
 * switching, screen share, and connection quality while the
 * participant is in the room. This component keeps owning the
 * path in and out: the lobby, the mint, the connect, the left
 * screen, and the failed screen with its retry when a
 * connection drops for good or the meeting infrastructure
 * cannot be reached at all.
 *
 * Epic 4 adds the waiting room (feature 4.3) and the removed
 * state (feature 4.2). In a waiting room meeting the guest
 * asks first: the ask mints nothing, the lobby polls the
 * join-info endpoint for the host's decision, and only an
 * admitted guest gets the Join button, with the mint
 * enforcing the same rule server side. A guest the host
 * removes lands on a removed screen, told apart from a
 * dropped guest and from an ended meeting by asking
 * join-info what actually happened on the way out.
 */

export interface JoinLobbyProps {
  bookingId: string;
  mode: 'host' | 'guest';
  guestToken: string | null;
  meetingName: string;
  hostName: string;
  initialName: string;
  dateLabel: string;
  timeLabel: string;
  opensAt: string;
  closesAt: string;
  /** Entry mode carried on the booking (Epic 4, feature 4.3). */
  entryMode: 'open' | 'waiting_room';
}

type Screen = 'lobby' | 'connecting' | 'inroom' | 'left' | 'gone' | 'failed' | 'removed';
type PreviewState = 'starting' | 'ready' | 'denied' | 'unavailable';
type Admission = 'none' | 'waiting' | 'admitted' | 'denied';

interface JoinInfo {
  phase?: string;
  admissionState?: Admission;
  removed?: boolean;
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function JoinLobby(props: JoinLobbyProps) {
  const { bookingId, mode, guestToken, opensAt, closesAt } = props;
  const waitingRoom = mode === 'guest' && props.entryMode === 'waiting_room';

  const [screen, setScreen] = useState<Screen>('lobby');
  const [goneMessage, setGoneMessage] = useState('');
  const [failedMessage, setFailedMessage] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [name, setName] = useState(props.initialName);
  const [roomNonce, setRoomNonce] = useState(0);
  const [admission, setAdmission] = useState<Admission>('none');
  const [admissionBusy, setAdmissionBusy] = useState(false);

  const [previewState, setPreviewState] = useState<PreviewState>('starting');
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState('');
  const [camId, setCamId] = useState('');
  const [speakerId, setSpeakerId] = useState('');
  const [micLevel, setMicLevel] = useState(0);
  const [previewNonce, setPreviewNonce] = useState(0);

  const [, setClockTick] = useState(0);

  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const levelAudioRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const roomRef = useRef<Room | null>(null);
  const intentionalLeaveRef = useRef(false);
  const screenRef = useRef<Screen>('lobby');
  screenRef.current = screen;

  const stopLevelMeter = useCallback(() => {
    if (levelAudioRef.current) {
      cancelAnimationFrame(levelAudioRef.current.raf);
      void levelAudioRef.current.ctx.close().catch(() => undefined);
      levelAudioRef.current = null;
    }
    setMicLevel(0);
  }, []);

  const stopPreview = useCallback(() => {
    stopLevelMeter();
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
    if (previewVideoRef.current) previewVideoRef.current.srcObject = null;
  }, [stopLevelMeter]);

  const startLevelMeter = useCallback(
    (stream: MediaStream) => {
      stopLevelMeter();
      if (!stream.getAudioTracks().length) return;
      try {
        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const loop = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const value of data) peak = Math.max(peak, Math.abs(value - 128) / 128);
          setMicLevel(Math.min(1, peak * 1.6));
          levelAudioRef.current = { ctx, raf: requestAnimationFrame(loop) };
        };
        levelAudioRef.current = { ctx, raf: requestAnimationFrame(loop) };
      } catch {
        // No meter is a cosmetic loss, never a join blocker.
      }
    },
    [stopLevelMeter],
  );

  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMics(devices.filter((d) => d.kind === 'audioinput'));
      setCams(devices.filter((d) => d.kind === 'videoinput'));
      setSpeakers(devices.filter((d) => d.kind === 'audiooutput'));
    } catch {
      // Enumeration failing leaves the pickers empty; joining
      // with the browser default still works.
    }
  }, []);

  const acquirePreview = useCallback(async () => {
    stopPreview();
    if (!camOn && !micOn) {
      setPreviewState('ready');
      return;
    }
    setPreviewState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: camOn ? (camId ? { deviceId: { exact: camId } } : true) : false,
        audio: micOn ? (micId ? { deviceId: { exact: micId } } : true) : false,
      });
      previewStreamRef.current = stream;
      if (previewVideoRef.current) previewVideoRef.current.srcObject = stream;
      startLevelMeter(stream);
      await refreshDevices();
      setPreviewState('ready');
    } catch (error) {
      const name = (error as { name?: string })?.name ?? '';
      setPreviewState(name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable' : 'denied');
    }
  }, [camOn, micOn, camId, micId, refreshDevices, startLevelMeter, stopPreview]);

  // The preview follows the toggles and the pickers: any change
  // re-acquires with the new wishes. It only runs in the lobby.
  useEffect(() => {
    if (screen !== 'lobby') return;
    void acquirePreview();
    return () => stopPreview();
  }, [acquirePreview, screen, previewNonce, stopPreview]);

  // Remembered devices (Epic 3, story 3.3.3): the lobby opens
  // with the mic, camera, and speaker the participant picked
  // last time, in this browser, and every later pick in the
  // lobby is written back for the next meeting. The room's own
  // pickers write to the same record.
  const applyRememberedDevices = useCallback(() => {
    const remembered = loadDeviceMemory();
    if (remembered.micId) setMicId(remembered.micId);
    if (remembered.camId) setCamId(remembered.camId);
    if (remembered.speakerId) setSpeakerId(remembered.speakerId);
  }, []);
  useEffect(() => {
    applyRememberedDevices();
  }, [applyRememberedDevices]);

  const skipFirstSaveRef = useRef(true);
  useEffect(() => {
    if (skipFirstSaveRef.current) {
      skipFirstSaveRef.current = false;
      return;
    }
    saveDeviceMemory({ micId, camId, speakerId });
  }, [micId, camId, speakerId]);

  // A clock for the "room opens at" state on the Join button.
  useEffect(() => {
    if (screen !== 'lobby') return;
    const timer = setInterval(() => setClockTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [screen]);

  useEffect(() => {
    return () => {
      stopPreview();
      void roomRef.current?.disconnect().catch(() => undefined);
      roomRef.current = null;
    };
  }, [stopPreview]);

  /**
   * The lobby's one read of the booking (Epic 2's join-info,
   * carrying the Epic 4 admission and removal state). It is
   * how a waiting guest learns the host's decision, and how a
   * disconnected guest learns whether they were removed, the
   * meeting ended, or the connection simply died.
   */
  const fetchJoinInfo = useCallback(async (): Promise<JoinInfo | null> => {
    if (mode !== 'guest' || !guestToken) return null;
    try {
      const res = await fetch(
        `/api/public/bookings/${bookingId}/join-info?t=${encodeURIComponent(guestToken)}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as JoinInfo;
    } catch {
      return null;
    }
  }, [bookingId, guestToken, mode]);

  // A waiting room guest who reloads after being admitted
  // should find the Join button waiting, not a fresh ask.
  useEffect(() => {
    if (!waitingRoom || screen !== 'lobby') return;
    let cancelled = false;
    void (async () => {
      const info = await fetchJoinInfo();
      if (cancelled || !info) return;
      if (info.removed) {
        setScreen('removed');
        return;
      }
      if (info.admissionState) setAdmission(info.admissionState);
    })();
    return () => {
      cancelled = true;
    };
  }, [waitingRoom, screen, fetchJoinInfo]);

  // While the guest waits, poll for the host's decision. The
  // wait always resolves into words: admitted, denied,
  // removed, or the meeting ended before a decision came.
  // Nobody waits on a silent spinner forever.
  useEffect(() => {
    if (!waitingRoom || screen !== 'lobby' || admission !== 'waiting') return;
    const timer = setInterval(() => {
      void (async () => {
        const info = await fetchJoinInfo();
        if (!info) return;
        if (info.removed) {
          setScreen('removed');
          return;
        }
        if (info.phase === 'closed' || info.phase === 'cancelled') {
          setGoneMessage('This meeting has ended. The room has closed.');
          setScreen('gone');
          return;
        }
        if (info.admissionState && info.admissionState !== 'waiting') {
          setAdmission(info.admissionState);
        }
      })();
    }, 2500);
    return () => clearInterval(timer);
  }, [waitingRoom, screen, admission, fetchJoinInfo]);

  async function askToJoin() {
    setAdmissionBusy(true);
    setJoinError(null);
    try {
      const res = await fetch(
        `/api/public/bookings/${bookingId}/waiting-room?t=${encodeURIComponent(guestToken ?? '')}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
      };
      if (!res.ok) {
        if (data.code === 'guest_removed') {
          setScreen('removed');
          return;
        }
        if (data.code === 'room_closed') {
          setGoneMessage('This meeting has ended. The room has closed.');
          setScreen('gone');
          return;
        }
        if (data.code === 'booking_cancelled') {
          setGoneMessage('This meeting was cancelled, so there is no room to join.');
          setScreen('gone');
          return;
        }
        setJoinError(data.error ?? 'Could not ask to join. Try again.');
        return;
      }
      setAdmission('waiting');
    } catch {
      setJoinError('Could not ask to join. Check your connection and try again.');
    } finally {
      setAdmissionBusy(false);
    }
  }

  async function mintToken(): Promise<{ token: string; url: string }> {
    if (mode === 'host') {
      const res = await fetch(`/api/v0/bookings/${bookingId}/room-token`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ displayName: name.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        url?: string;
        code?: string;
        error?: string;
      };
      if (!res.ok || !data.token || !data.url) {
        throw Object.assign(new Error(data.error ?? 'Could not get a room token'), {
          code: data.code ?? 'mint_failed',
        });
      }
      return { token: data.token, url: data.url };
    }
    const res = await fetch(
      `/api/public/bookings/${bookingId}/room-token?t=${encodeURIComponent(guestToken ?? '')}&name=${encodeURIComponent(name.trim())}`,
    );
    const data = (await res.json().catch(() => ({}))) as {
      token?: string;
      url?: string;
      code?: string;
      error?: string;
    };
    if (!res.ok || !data.token || !data.url) {
      throw Object.assign(new Error(data.error ?? 'Could not get a room token'), {
        code: data.code ?? 'mint_failed',
      });
    }
    return { token: data.token, url: data.url };
  }

  async function join(overrides?: { cam: boolean; mic: boolean }) {
    const useCam = overrides?.cam ?? camOn;
    const useMic = overrides?.mic ?? micOn;
    setJoinError(null);
    intentionalLeaveRef.current = false;
    setScreen('connecting');
    try {
      const minted = await mintToken();
      stopPreview();
      const room = new Room({
        videoCaptureDefaults: camId ? { deviceId: camId } : undefined,
        audioCaptureDefaults: micId ? { deviceId: micId } : undefined,
        adaptiveStream: true,
        dynacast: true,
      });
      roomRef.current = room;
      // The room component owns every in room event. The one
      // event owned here is the final disconnect: LiveKit
      // reconnects on its own through transient drops, so a
      // Disconnected that reaches this handler means it gave
      // up, OR the server ended this participant's time in
      // the room (Epic 4: the host removed them, or ended the
      // meeting for everyone). A guest asks join-info which
      // of those it was before landing anywhere, so a removed
      // guest sees the removal message and not a fake
      // connection failure. A disconnect we asked for (Leave)
      // is none of these.
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return;
        roomRef.current = null;
        if (intentionalLeaveRef.current) return;
        if (screenRef.current !== 'inroom' && screenRef.current !== 'connecting') return;
        if (mode === 'guest') {
          void (async () => {
            const info = await fetchJoinInfo();
            if (info?.removed) {
              setScreen('removed');
              return;
            }
            if (info && (info.phase === 'closed' || info.phase === 'cancelled')) {
              setGoneMessage('The host ended this meeting. The room has closed.');
              setScreen('gone');
              return;
            }
            setFailedMessage(
              'The connection to the meeting dropped and could not be restored.',
            );
            setScreen('failed');
          })();
          return;
        }
        setFailedMessage(
          'The connection to the meeting dropped and could not be restored.',
        );
        setScreen('failed');
      });
      await room.connect(minted.url, minted.token);
      if (speakerId) {
        try {
          await room.switchActiveDevice('audiooutput', speakerId);
        } catch {
          // Speaker switching is not supported everywhere (Firefox);
          // the system default keeps working.
        }
      }
      if (useMic) await room.localParticipant.setMicrophoneEnabled(true);
      if (useCam) await room.localParticipant.setCameraEnabled(true);
      setRoomNonce((n) => n + 1);
      setScreen('inroom');
    } catch (error) {
      const code = (error as { code?: string })?.code ?? '';
      void roomRef.current?.disconnect().catch(() => undefined);
      roomRef.current = null;
      if (code === 'room_closed') {
        setGoneMessage('This meeting has ended. The room has closed.');
        setScreen('gone');
      } else if (code === 'booking_cancelled') {
        setGoneMessage('This meeting was cancelled, so there is no room to join.');
        setScreen('gone');
      } else if (code === 'bad_token') {
        setGoneMessage('That join link is not valid. Use the exact link from your invite.');
        setScreen('gone');
      } else if (code === 'guest_removed') {
        setScreen('removed');
      } else if (code === 'admission_required') {
        // The host has not admitted this guest (the mint
        // refuses a publishing token before admission, Epic
        // 4). Back to the waiting state in plain words; the
        // lobby poll picks up any later decision.
        setAdmission('waiting');
        setJoinError('The host has not let you in yet. You are back in the waiting room.');
        setScreen('lobby');
        setPreviewNonce((n) => n + 1);
      } else if (code === 'room_not_open') {
        setJoinError(`The room has not opened yet. It opens at ${timeLabel(opensAt)}.`);
        setScreen('lobby');
        setPreviewNonce((n) => n + 1);
      } else if (code === 'livekit_not_configured') {
        setJoinError('Video is not set up for this meeting yet. Let the host know.');
        setScreen('lobby');
        setPreviewNonce((n) => n + 1);
      } else {
        // The mint answered but the connect itself failed:
        // the meeting infrastructure could not be reached.
        // Plain words and a retry, the redChat voice style
        // (story 3.5.4).
        setFailedMessage(
          'Meeting infrastructure is unreachable right now. Check your connection, then try again.',
        );
        setScreen('failed');
      }
    }
  }

  async function leave() {
    intentionalLeaveRef.current = true;
    await roomRef.current?.disconnect().catch(() => undefined);
    roomRef.current = null;
    setScreen('left');
  }

  const notYetOpen = Date.now() < new Date(opensAt).getTime();
  const alreadyClosed = Date.now() > new Date(closesAt).getTime();

  const deviceLabel = (d: MediaDeviceInfo, kind: string, i: number) =>
    d.label || `${kind} ${i + 1}`;

  if (screen === 'gone') {
    return (
      <div className="rounded-2xl border border-border bg-bg-secondary p-8" data-testid="join-gone">
        <h1 className="text-2xl font-semibold">{props.meetingName}</h1>
        <p className="mt-2 text-sm text-text-secondary">{goneMessage}</p>
      </div>
    );
  }

  if (screen === 'removed') {
    return (
      <div className="rounded-2xl border border-border bg-bg-secondary p-8" data-testid="join-removed">
        <h1 className="text-2xl font-semibold">You were removed from the meeting</h1>
        <p className="mt-2 text-sm text-text-secondary">
          The host removed you from {props.meetingName}, so this link no longer works.
          If that is a surprise, reply to your calendar invite and ask the host.
        </p>
      </div>
    );
  }

  if (screen === 'left') {
    return (
      <div className="rounded-2xl border border-border bg-bg-secondary p-8" data-testid="join-left">
        <h1 className="text-2xl font-semibold">You left the meeting</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Your link still works. You can come back in any time until the room closes at{' '}
          {timeLabel(closesAt)}.
        </p>
        <button
          type="button"
          data-testid="rejoin-button"
          onClick={() => {
            // The room may have saved new device picks while
            // this component stayed mounted; the lobby must
            // open with them, not with its own older state.
            applyRememberedDevices();
            setScreen('lobby');
            setPreviewNonce((n) => n + 1);
          }}
          className="mt-6 rounded-lg bg-[var(--primary-color)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
        >
          Back to the lobby
        </button>
      </div>
    );
  }

  if (screen === 'failed') {
    return (
      <div className="rounded-2xl border border-border bg-bg-secondary p-8" data-testid="join-failed">
        <h1 className="text-2xl font-semibold">{props.meetingName}</h1>
        <p className="mt-2 text-sm text-text-secondary">{failedMessage}</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="retry-button"
            onClick={() => void join()}
            className="rounded-lg bg-[var(--primary-color)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={() => {
              applyRememberedDevices();
              setScreen('lobby');
              setPreviewNonce((n) => n + 1);
            }}
            className="rounded-lg border border-border px-5 py-2.5 text-sm text-text-secondary transition hover:text-text-primary"
          >
            Back to the lobby
          </button>
        </div>
      </div>
    );
  }

  if (screen === 'connecting') {
    return (
      <div className="rounded-2xl border border-border bg-bg-secondary p-8" data-testid="room-connecting">
        <h1 className="text-2xl font-semibold">{props.meetingName}</h1>
        <p className="mt-2 text-sm text-text-secondary" role="status">
          Connecting to the meeting...
        </p>
      </div>
    );
  }

  if (screen === 'inroom' && roomRef.current) {
    return (
      <MeetingRoom
        key={roomNonce}
        room={roomRef.current}
        bookingId={bookingId}
        isHost={mode === 'host'}
        meetingName={props.meetingName}
        hostName={props.hostName}
        initialDevices={{ micId, camId, speakerId }}
        onLeave={() => void leave()}
        onEnded={() => {
          intentionalLeaveRef.current = true;
          void roomRef.current?.disconnect().catch(() => undefined);
          roomRef.current = null;
          setGoneMessage('You ended this meeting, and the room is closed for everyone.');
          setScreen('gone');
        }}
      />
    );
  }

  // Lobby (story 2.2).
  return (
    <div className="rounded-2xl border border-border bg-bg-secondary p-8" data-testid="join-lobby">
      <h1 className="text-2xl font-semibold">{props.meetingName}</h1>
      <p className="mt-2 text-sm text-text-secondary">
        with {props.hostName}, {props.dateLabel}, {props.timeLabel}
      </p>

      <label className="mt-6 block text-sm font-medium" htmlFor="join-name">
        Your name
      </label>
      <input
        id="join-name"
        data-testid="name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={120}
        className="mt-1 w-full max-w-md rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
      />

      <div className="relative mt-6 aspect-video w-full max-w-md overflow-hidden rounded-xl bg-black">
        <video
          ref={previewVideoRef}
          autoPlay
          playsInline
          muted
          data-testid="preview-video"
          className={`h-full w-full object-cover ${camOn ? '' : 'hidden'}`}
        />
        {!camOn && (
          <div className="flex h-full w-full items-center justify-center text-sm text-white/70">
            Camera is off
          </div>
        )}
      </div>

      {(previewState === 'denied' || previewState === 'unavailable') && (
        <div
          className="mt-4 max-w-md rounded-xl border border-border p-4"
          data-testid="permission-denied"
        >
          <p className="text-sm font-medium">
            {previewState === 'denied'
              ? 'Your browser blocked the camera or microphone'
              : 'No camera or microphone was found'}
          </p>
          <p className="mt-1 text-sm text-text-secondary">
            {previewState === 'denied'
              ? 'redMeet needs your permission to use them. Check the camera icon in your browser address bar, allow access, then try again. You can also join without video, or just listen.'
              : 'This device does not seem to have a camera or microphone available. You can still join and listen.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setPreviewNonce((n) => n + 1)}
              className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary"
            >
              Try again
            </button>
            {previewState === 'denied' && (
              <button
                type="button"
                data-testid="audio-only-button"
                onClick={() => setCamOn(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary"
              >
                Join with microphone only
              </button>
            )}
            <button
              type="button"
              data-testid="listen-only-button"
              onClick={() => {
                setCamOn(false);
                setMicOn(false);
                void join({ cam: false, mic: false });
              }}
              className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary"
            >
              Listen only
            </button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="mic-toggle"
          aria-pressed={micOn}
          onClick={() => setMicOn((v) => !v)}
          className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary"
        >
          Microphone: {micOn ? 'On' : 'Off'}
        </button>
        <button
          type="button"
          data-testid="camera-toggle"
          aria-pressed={camOn}
          onClick={() => setCamOn((v) => !v)}
          className="rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary"
        >
          Camera: {camOn ? 'On' : 'Off'}
        </button>
        <div className="flex items-center gap-2" aria-hidden>
          <span className="text-xs text-text-secondary">Mic level</span>
          <div className="h-2 w-24 overflow-hidden rounded bg-black/30">
            <div
              className="h-full bg-green-500 transition-[width] duration-75"
              style={{ width: `${Math.round(micLevel * 100)}%` }}
              data-testid="mic-level"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 grid max-w-md gap-3">
        <label className="block text-sm">
          <span className="text-text-secondary">Microphone</span>
          <select
            data-testid="device-mic"
            value={micId}
            onChange={(e) => setMicId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
          >
            <option value="">Browser default</option>
            {mics.map((d, i) => (
              <option key={d.deviceId || `mic-${i}`} value={d.deviceId}>
                {deviceLabel(d, 'Microphone', i)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-text-secondary">Camera</span>
          <select
            data-testid="device-camera"
            value={camId}
            onChange={(e) => setCamId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
          >
            <option value="">Browser default</option>
            {cams.map((d, i) => (
              <option key={d.deviceId || `cam-${i}`} value={d.deviceId}>
                {deviceLabel(d, 'Camera', i)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-text-secondary">Speaker</span>
          <select
            data-testid="device-speaker"
            value={speakerId}
            onChange={(e) => setSpeakerId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text-primary"
          >
            <option value="">Browser default</option>
            {speakers.map((d, i) => (
              <option key={d.deviceId || `spk-${i}`} value={d.deviceId}>
                {deviceLabel(d, 'Speaker', i)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {joinError && (
        <p className="mt-4 max-w-md rounded-lg border border-accent/40 px-3 py-2 text-sm text-text-secondary" data-testid="join-error">
          {joinError}
        </p>
      )}

      {waitingRoom && admission === 'waiting' ? (
        <div
          className="mt-6 max-w-md rounded-xl border border-border p-4"
          data-testid="waiting-panel"
          role="status"
        >
          <p className="text-sm font-medium">You are in the waiting room</p>
          <p className="mt-1 text-sm text-text-secondary">
            {props.hostName} will let you in soon. Stay on this page, and you will be
            able to join the moment they do.
          </p>
        </div>
      ) : waitingRoom && admission === 'denied' ? (
        <div
          className="mt-6 max-w-md rounded-xl border border-border p-4"
          data-testid="admission-denied"
        >
          <p className="text-sm font-medium">The host could not admit you</p>
          <p className="mt-1 text-sm text-text-secondary">
            That ends this try. If you think it was a mistake, ask again and the host
            will see a new request.
          </p>
          <button
            type="button"
            data-testid="ask-again-button"
            disabled={notYetOpen || alreadyClosed || !name.trim() || admissionBusy}
            onClick={() => void askToJoin()}
            className="mt-3 rounded-lg bg-[var(--primary-color)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ask again
          </button>
        </div>
      ) : waitingRoom && admission !== 'admitted' ? (
        <>
          <button
            type="button"
            data-testid="ask-to-join-button"
            disabled={notYetOpen || alreadyClosed || !name.trim() || admissionBusy}
            onClick={() => void askToJoin()}
            className="mt-6 rounded-lg bg-[var(--primary-color)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {alreadyClosed
              ? 'This meeting has ended'
              : notYetOpen
                ? `Room opens at ${timeLabel(opensAt)}`
                : 'Ask to join'}
          </button>
          {!notYetOpen && !alreadyClosed && (
            <p className="mt-2 text-xs text-text-secondary">
              This meeting uses a waiting room. Ask to join, and {props.hostName} will
              let you in.
            </p>
          )}
        </>
      ) : (
        <>
          <button
            type="button"
            data-testid="join-button"
            disabled={notYetOpen || alreadyClosed || !name.trim()}
            onClick={() => void join()}
            className="mt-6 rounded-lg bg-[var(--primary-color)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {alreadyClosed
              ? 'This meeting has ended'
              : notYetOpen
                ? `Room opens at ${timeLabel(opensAt)}`
                : 'Join meeting'}
          </button>
          {!notYetOpen && !alreadyClosed && (
            <p className="mt-2 text-xs text-text-secondary">
              {waitingRoom
                ? `The host let you in. The room closes at ${timeLabel(closesAt)}.`
                : `The room is open. It closes at ${timeLabel(closesAt)}.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
