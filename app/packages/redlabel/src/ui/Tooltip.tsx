'use client';

import { useCallback, useId, useState } from 'react';
import type React from 'react';

/**
 * A tooltip on a focusable child.
 *
 * It opens on hover AND on focus and closes on `Escape` and on blur, which is
 * the part most tooltips get wrong: a hover-only tooltip is invisible to a
 * keyboard, and one with no `Escape` is a trap over the control it describes.
 *
 * The child keeps its own identity. This wrapper adds `aria-describedby` to it
 * rather than wrapping it in a button, so a tooltip on a link is still a link
 * and the accessible name still comes from the control.
 *
 * **Positioning.** The anchor positioning API is used where the browser has it,
 * so the bubble escapes an `overflow: hidden` ancestor; everywhere else it falls
 * back to a plain absolutely positioned bubble inside a `relative` wrapper. The
 * fallback is the default and the upgrade is an `@supports` block in
 * `src/css/redlabel.css`, so a browser without the API gets correct behaviour
 * rather than a hidden bubble.
 */
export interface TooltipProps {
  /** The bubble's text. Plain text, because it is also the accessible description. */
  content: React.ReactNode;
  /** The focusable control being described. */
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

export function Tooltip({
  content,
  children,
  side = 'top',
  className,
}: TooltipProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const id = useId();

  const close = useCallback(() => setOpen(false), []);
  const onKeyDown = useCallback((event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') setOpen(false);
  }, []);

  return (
    <span
      className={['rl-tooltip-anchor relative inline-flex', className].filter(Boolean).join(' ')}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={close}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={close}
      onKeyDown={onKeyDown}
    >
      <span aria-describedby={open ? id : undefined} className="contents">
        {children}
      </span>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={[
            'rl-tooltip pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2',
            'rounded-lg border border-border-hover bg-[var(--bg-overlay)] px-2 py-1 text-xs',
            'text-text-secondary shadow-lg',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          ].join(' ')}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
