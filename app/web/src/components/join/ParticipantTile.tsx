'use client';

import { useEffect, useRef } from 'react';
import { MicOff, SignalLow } from 'lucide-react';
import type { Track } from 'livekit-client';

import { colorForIdentity, initialsFor } from '@/lib/room-ui';

/**
 * One participant on the stage (Epic 3, feature 3.1): their video
 * when there is one, an initials avatar when there is not, their
 * name, a muted badge everyone can see, a speaking indicator, and
 * the connection quality badges from feature 3.5. The tile attaches
 * whatever track it is handed and detaches it on the way out; it
 * owns no room state.
 *
 * The tile always FILLS its parent: the room decides the box (a
 * best-fit grid cell, a filmstrip slot, the picture in picture
 * corner, or the whole stage), the tile only paints into it.
 * `variant` only tunes the chrome for the box size.
 */
export interface TileView {
  identity: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  micMuted: boolean;
  /** The camera track to show, or null for the initials fallback. */
  videoTrack: Track | null;
  poorConnection: boolean;
  /** Video was dropped to audio only because of the connection. */
  audioOnly: boolean;
}

export type TileVariant = 'grid' | 'strip' | 'pip';

export function ParticipantTile({
  view,
  variant = 'grid',
}: {
  view: TileView;
  variant?: TileVariant;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const track = view.videoTrack;
  const small = variant !== 'grid';

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
      data-testid="participant-tile"
      data-identity={view.identity}
      data-speaking={view.isSpeaking || undefined}
      className={`relative h-full w-full overflow-hidden bg-zinc-900 transition-shadow duration-200 ${
        variant === 'pip' ? 'rounded-xl' : 'rounded-2xl'
      } ${
        view.isSpeaking
          ? 'shadow-[0_0_0_2px_rgb(52,211,153),0_0_24px_rgba(52,211,153,0.25)]'
          : 'shadow-[0_0_0_1px_rgba(255,255,255,0.08)]'
      }`}
    >
      {track ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`h-full w-full object-cover ${view.isLocal ? '-scale-x-100' : ''}`}
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,0.06),transparent_70%)]"
          data-testid="tile-fallback"
        >
          <span
            className={`flex aspect-square items-center justify-center rounded-full font-semibold text-white ${
              small ? 'w-[38%] max-w-14 text-sm' : 'w-[28%] min-w-14 max-w-28 text-2xl sm:text-3xl'
            } ${view.isSpeaking ? 'ring-4 ring-emerald-400/50' : ''}`}
            style={{ backgroundColor: colorForIdentity(view.identity) }}
          >
            {initialsFor(view.name)}
          </span>
        </div>
      )}

      <div
        className={`absolute flex max-w-[calc(100%-1rem)] items-center gap-1.5 rounded-full bg-black/55 text-white backdrop-blur-sm ${
          small ? 'bottom-1.5 left-1.5 px-2 py-0.5' : 'bottom-2 left-2 px-2.5 py-1'
        }`}
      >
        {view.micMuted && (
          <span
            className="flex shrink-0 items-center text-red-400"
            data-testid="tile-muted"
            aria-label="Muted"
            title="Muted"
          >
            <MicOff className={small ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden />
          </span>
        )}
        {view.isSpeaking && !view.micMuted && (
          <span
            className="flex h-3 shrink-0 items-end gap-[2px]"
            data-testid="tile-speaking"
            aria-label="Speaking"
            title="Speaking"
          >
            <span className="w-[3px] animate-[rm-eq_0.9s_ease-in-out_infinite] rounded-full bg-emerald-400" />
            <span className="w-[3px] animate-[rm-eq_0.9s_ease-in-out_0.15s_infinite] rounded-full bg-emerald-400" />
            <span className="w-[3px] animate-[rm-eq_0.9s_ease-in-out_0.3s_infinite] rounded-full bg-emerald-400" />
          </span>
        )}
        <span
          className={`truncate font-medium ${small ? 'text-[10px]' : 'text-xs'}`}
          data-testid="tile-name"
        >
          {view.name}
          {view.isLocal ? ' (you)' : ''}
        </span>
      </div>

      {view.audioOnly && (
        <span
          className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm"
          data-testid="tile-audio-only"
        >
          {small ? 'Audio only' : 'Audio only, poor connection'}
        </span>
      )}
      {view.poorConnection && !view.audioOnly && (
        <span
          className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-amber-300 backdrop-blur-sm"
          data-testid="tile-poor"
          title="Poor connection"
        >
          <SignalLow className="h-3 w-3" aria-hidden />
          {!small && 'Poor connection'}
        </span>
      )}
    </div>
  );
}
