'use client';

import { useEffect, useState } from 'react';
import type React from 'react';

import { BottomSheet } from './BottomSheet';
import { Tooltip } from './Tooltip';

/**
 * The small `i` that explains one thing, and the reason the product has no walls
 * of prose.
 *
 * Two surfaces, chosen by INPUT and not by width: a tooltip under a fine
 * pointer, a bottom sheet under a coarse one. A tooltip on a touch screen has no
 * hover to open it and no blur to close it, so it either never appears or never
 * goes away; a sheet on a desk is a modal interruption for one sentence.
 *
 * The button is 16px because its size is the point: it sits inline in a label
 * and must not push the row around. `rl-tap-halo` gives it a 44px hit area from
 * an invisible `inset: -15px` overlay under `@media (pointer: coarse)`, so the
 * target is honest without one pixel moving on screen.
 *
 * `matchMedia` runs in an effect, so the first render is the tooltip path on
 * every device. That is the right default rather than a guess: server and client
 * render the same markup, so there is no hydration mismatch, and a touch user's
 * first tap lands after the effect has already corrected it.
 */
export interface InfoTipProps {
  /** What this explains. Also the sheet's title, so it is short and plain. */
  label: string;
  children: React.ReactNode;
  className?: string;
}

export function InfoTip({ label, children, className }: InfoTipProps): React.JSX.Element {
  const [coarse, setCoarse] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(pointer: coarse)');
    setCoarse(query.matches);
    const onChange = (event: MediaQueryListEvent): void => setCoarse(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const trigger = (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-expanded={coarse ? open : undefined}
      onClick={coarse ? () => setOpen(true) : undefined}
      className={[
        'rl-tap-halo inline-flex size-4 shrink-0 items-center justify-center rounded-full',
        'border border-border text-[10px] leading-none font-semibold text-text-muted',
        'hover:border-border-hover hover:text-text-secondary',
        'focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span aria-hidden="true">i</span>
    </button>
  );

  if (!coarse) {
    return <Tooltip content={children}>{trigger}</Tooltip>;
  }

  return (
    <>
      {trigger}
      <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
        <div className="text-sm text-text-secondary">{children}</div>
      </BottomSheet>
    </>
  );
}
