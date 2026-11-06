'use client';

import { useId, useRef } from 'react';
import type React from 'react';

import { useModalSurface } from './useModalSurface';

/**
 * The modal surface, in one implementation with two presentations: below `md` it
 * is a bottom sheet with a drag handle and `env(safe-area-inset-bottom)` padding,
 * at `md` and up it is a right-side drawer. `./ui/Drawer` is the same component
 * under the name ui.md uses for the desktop shape.
 *
 * **Mounted only while open.** A closed sheet that stays in the tree keeps its
 * subtree's effects, its data and its scroll position alive on every page, and
 * on a findings list that is one mounted drawer per row.
 *
 * Everything ui.md 2.3 requires of a modal is in `useModalSurface`: a real focus
 * trap, `Escape`, focus restored to the opener, `inert` on the background and a
 * scroll lock that does not shift layout. redstyle's `Dialog` has none of the
 * first four, which is why this exists.
 *
 * It carries `.select-text` and a `max-h-[85dvh]` scroll region, because this is
 * the findings DETAIL surface: its content is paths, snippets and rationale, and
 * a global `user-select: none` from redstyle's `base.css` would make none of it
 * copyable.
 */
export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** Rendered as the surface's `<h2>` and wired to `aria-labelledby`. */
  title: string;
  /** Optional line under the title, wired to `aria-describedby`. */
  description?: string;
  /** Pinned under the scroll region. Actions, not content. */
  footer?: React.ReactNode;
  /** Focus lands here on open. Defaults to the first focusable element. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children?: React.ReactNode;
  className?: string;
}

export function BottomSheet({
  open,
  onClose,
  title,
  description,
  footer,
  initialFocusRef,
  children,
  className,
}: BottomSheetProps): React.JSX.Element | null {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const id = useId();
  useModalSurface(
    initialFocusRef ? { open, onClose, surfaceRef, initialFocusRef } : { open, onClose, surfaceRef },
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-stretch md:justify-end">
      {/* A backdrop is a click target, not a control: the surface owns Escape
          and the header owns the close button, so this carries no role and is
          hidden from assistive technology. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="rl-sheet-backdrop absolute inset-0 bg-[var(--backdrop)] backdrop-blur-sm"
      />
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        aria-describedby={description ? `${id}-description` : undefined}
        tabIndex={-1}
        className={[
          'rl-sheet relative flex max-h-[85dvh] w-full flex-col',
          'rounded-t-2xl border border-border-hover bg-[var(--bg-overlay)] shadow-2xl',
          'md:h-dvh md:max-h-none md:w-[32rem] md:max-w-full md:rounded-none md:rounded-l-2xl',
          'focus-visible:outline-none',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {/* The drag handle is the phone affordance and means nothing on a
            desktop drawer, so it is hidden there and from screen readers. */}
        <span
          aria-hidden="true"
          className="mx-auto mt-2 block h-1 w-10 shrink-0 rounded-full bg-border md:hidden"
        />
        <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-2">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="truncate text-sm font-semibold text-text-primary">
              {title}
            </h2>
            {description ? (
              <p id={`${id}-description`} className="mt-0.5 text-xs text-text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="tap -mr-1 shrink-0 rounded-lg p-1.5 text-text-muted hover:bg-bg-hover hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            <span aria-hidden="true">{'×'}</span>
          </button>
        </div>
        <div className="select-text min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {footer ? (
          <div className="shrink-0 border-t border-border px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
