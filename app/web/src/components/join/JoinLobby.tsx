'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track, type Participant } from 'livekit-client';

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
 * EPIC 3 REPLACEMENT POINT: what renders after connect is a
 * deliberately MINIMAL room shell: a connected badge, the local
 * preview, who is in the room by name, and a Leave button. No
 * tiles, no grid, no screen share UI, no in room device
 * switching. Epic 3 replaces the shell section below with the
 * real room UI and keeps everything above it (lobby, mint,
 * connect) as is.
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
}

type Screen = 'lobby' | 'connecting' | 'inroom' | 'left' | 'gone';
type PreviewState = 'starting' | 'ready' | 'denied' | 'unavailable';

interface ParticipantRow {
  identity: string;
  name: string;
  isLocal: boolean;
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

export function JoinLobby(props: JoinLobbyProps) {
  const { bookingId, mode, guestToken, opensAt, closesAt } = props;

  const [screen, setScreen] = useState<Screen>('lobby');
  const [goneMessage, setGoneMessage] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [name, setName] = useState(props.initialName);

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

  const [participants, setParticipants] = useState<ParticipantRow[]>([]);

  const [, setClockTick] = useState(0);

  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const levelAudioRef = useRef<{ ctx: AudioContext; raf: number } | null>(null);
  const roomRef = useRef<Room | null>(null);
  const shellVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLDivElement | null>(null);
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

  const syncParticipants = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const rows: ParticipantRow[] = [
      {
        identity: room.localParticipant.identity,
        name: room.localParticipant.name || 'You',
        isLocal: true,
      },
    ];
    room.remoteParticipants.forEach((p: Participant) => {
      rows.push({ identity: p.identity, name: p.name || p.identity, isLocal: false });
    });
    setParticipants(rows);
  }, []);

  // Attach the local camera inside the shell once it renders.
  useEffect(() => {
    if (screen !== 'inroom') return;
    const room = roomRef.current;
    const video = shellVideoRef.current;
    if (!room || !video) return;
    for (const pub of room.localParticipant.videoTrackPublications.values()) {
      if (pub.track && pub.source === Track.Source.Camera) {
        pub.track.attach(video);
        return;
      }
    }
  }, [screen, participants]);

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
      room.on(RoomEvent.ParticipantConnected, syncParticipants);
      room.on(RoomEvent.ParticipantDisconnected, syncParticipants);
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio && remoteAudioRef.current) {
          remoteAudioRef.current.appendChild(track.attach());
        }
        syncParticipants();
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
      });
      room.on(RoomEvent.Disconnected, () => {
        roomRef.current = null;
        setParticipants([]);
        if (screenRef.current === 'inroom' || screenRef.current === 'connecting') {
          setScreen('left');
        }
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
      syncParticipants();
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
      } else if (code === 'room_not_open') {
        setJoinError(`The room has not opened yet. It opens at ${timeLabel(opensAt)}.`);
        setScreen('lobby');
        setPreviewNonce((n) => n + 1);
      } else if (code === 'livekit_not_configured') {
        setJoinError('Video is not set up for this meeting yet. Let the host know.');
        setScreen('lobby');
        setPreviewNonce((n) => n + 1);
      } else {
        setJoinError('Could not connect to the meeting. Check your connection and try again.');
        setScreen('lobby');
        setPreviewNonce((n) => n + 1);
      }
    }
  }

  async function leave() {
    await roomRef.current?.disconnect().catch(() => undefined);
    roomRef.current = null;
    setParticipants([]);
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

  if (screen === 'inroom' || screen === 'connecting') {
    return (
      <div className="rounded-2xl border border-border bg-bg-secondary p-8" data-testid="room-shell">
        {/* EPIC 3 REPLACEMENT POINT: this minimal shell (connected
            badge, local preview, names, Leave) is replaced by the
            real room UI in Epic 3. The lobby and connect path that
            got us here stay. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">{props.meetingName}</h1>
            <p className="mt-1 text-sm text-text-secondary">with {props.hostName}</p>
          </div>
          <span
            className="rounded-full bg-black/25 px-3 py-1 text-xs font-medium"
            data-testid="connected-badge"
          >
            {screen === 'connecting' ? 'Connecting...' : 'Connected'}
          </span>
        </div>

        <video
          ref={shellVideoRef}
          autoPlay
          playsInline
          muted
          data-testid="shell-local-video"
          className="mt-6 aspect-video w-full max-w-md rounded-xl bg-black object-cover"
        />

        <h2 className="mt-6 text-sm font-medium">In this meeting</h2>
        <ul className="mt-2 space-y-1 text-sm text-text-secondary" data-testid="participant-list">
          {participants.map((p) => (
            <li key={p.identity}>
              {p.name}
              {p.isLocal ? ' (you)' : ''}
            </li>
          ))}
        </ul>

        <div ref={remoteAudioRef} className="hidden" aria-hidden />

        <button
          type="button"
          data-testid="leave-button"
          onClick={() => void leave()}
          className="mt-8 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-500"
        >
          Leave
        </button>
      </div>
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
          The room is open. It closes at {timeLabel(closesAt)}.
        </p>
      )}
    </div>
  );
}
