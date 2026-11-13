'use client';

import { useEffect, useRef } from 'react';
import { MicOff, SignalLow } from 'lucide-react';
import type { Track } from 'livekit-client';

import { colorForIdentity, initialsFor } from '@/lib/room-ui';

/**
 * One participant on the grid (Epic 3, feature 3.1): their
 * video when there is one, initials on a color when there is
 * not, their name, a muted badge everyone can see, a speaking
 * indicator, and the connection quality badges from feature
 * 3.5. The tile attaches whatever track it is handed and
 * detaches it on the way out; it owns no room state.
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

export function ParticipantTile({
  view,
  compact = false,
}: {
  view: TileView;
  compact?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const track = view.videoTrack;

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
      className={`relative aspect-video w-full overflow-hidden rounded-xl bg-black ${
        view.isSpeaking
          ? 'shadow-[0_0_0_2px_rgba(74,222,128,0.9)]'
          : 'shadow-[0_0_0_1px_rgba(255,255,255,0.12)]'
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
          className="flex h-full w-full items-center justify-center"
          style={{ backgroundColor: colorForIdentity(view.identity) }}
          data-testid="tile-fallback"
        >
          <span
            className={`font-semibold text-white ${compact ? 'text-lg' : 'text-4xl'}`}
          >
            {initialsFor(view.name)}
          </span>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-end gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-6">
        <span
          className="truncate text-xs font-medium text-white"
          data-testid="tile-name"
        >
          {view.name}
          {view.isLocal ? ' (you)' : ''}
        </span>
        {view.isSpeaking && (
          <span
            className="flex shrink-0 items-center gap-1 text-[10px] font-medium text-green-300"
            data-testid="tile-speaking"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-green-400" />
            Speaking
          </span>
        )}
        {view.micMuted && (
          <span
            className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-red-600/90 px-2 py-0.5 text-[10px] font-medium text-white"
            data-testid="tile-muted"
          >
            <MicOff className="h-3 w-3" aria-hidden />
            Muted
          </span>
        )}
      </div>

      {view.audioOnly && (
        <span
          className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white"
          data-testid="tile-audio-only"
        >
          Audio only, poor connection
        </span>
      )}
      {view.poorConnection && !view.audioOnly && (
        <span
          className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-medium text-amber-300"
          data-testid="tile-poor"
        >
          <SignalLow className="h-3 w-3" aria-hidden />
          Poor connection
        </span>
      )}
    </div>
  );
}
