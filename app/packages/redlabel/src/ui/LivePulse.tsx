import type React from 'react';

/**
 * The "something is happening right now" pulse, and redstyle leak 2's workaround.
 *
 * redstyle's `@keyframes streaming-pulse` glows `rgba(239,68,68,.15)`
 * (`base.css:164-165`), so the live pulse is redbtn red on every brand. In
 * redScan the live scan view IS the product, which makes this the most visible
 * leak of the eight. `rl-streaming-pulse` mixes `var(--accent)` instead.
 *
 * As with `Skeleton`, the NAME has to differ: `base.css` ships
 * `.light .streaming-pulse` at (0,2,0), which beats a local `.streaming-pulse`.
 * Never use redstyle's class, not even a tokenized copy of it.
 *
 * **No `'use client'`, deliberately.** redlabel.md 1.3 lists this component in
 * the client column, but it calls no hook and holds no state: it is a wrapper and
 * a CSS animation. A directive on a hook-free file is banned by AGENTS.md and by
 * `scripts/check-redlabel-boundaries.mjs`, and it would cost more than style:
 * `PipelineRail` renders the pulse inside a server-rendered stage list, and a
 * client directive here would drag that subtree across the boundary for an
 * animation. A seam request asks for the 1.3 row to move.
 *
 * It is a decoration on a fact the surface already states in text (a stage name,
 * a count, an elapsed time), so it is `aria-hidden` and it stops under
 * `prefers-reduced-motion`, which `src/css/redlabel.css` handles.
 */
export interface LivePulseProps {
  /** The thing that is pulsing. A dot, a chip, a stage row. */
  children?: React.ReactNode;
  className?: string;
}

export function LivePulse({ children, className }: LivePulseProps): React.JSX.Element {
  return (
    <span
      aria-hidden={children === undefined ? 'true' : undefined}
      className={['rl-streaming-pulse inline-flex items-center rounded-full', className]
        .filter(Boolean)
        .join(' ')}
    >
      {children ?? <span className="block size-2 rounded-full bg-info" />}
    </span>
  );
}
