'use client';

/**
 * The modal behaviours ui.md 2.3 requires on every modal surface, in one hook:
 * a real focus trap, `Escape`, focus restored to the opener, `inert` on the
 * background, and a scroll lock that does not shift layout.
 *
 * redstyle's `Dialog` has initial focus and focus restore but NO trap and no
 * mobile variant, which is why redScan's `ConfirmDialog` is built on this rather
 * than on it.
 *
 * The pure pieces are exported and tested on their own, because everything below
 * that touches the DOM cannot run in this package's test environment, which is
 * `node` and has no DOM by rule (redlabel.md 10). `focusableIn` and
 * `nextFocusIndex` are where the trap's actual logic lives.
 */
import { useEffect, useRef } from 'react';

/**
 * What a `Tab` may land on.
 *
 * `:not([inert])` and the `disabled`/`hidden` exclusions matter: a trap that
 * cycles onto a disabled control looks like the trap is broken, and one that
 * ignores `inert` walks straight out into the page this hook just inerted.
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
]
  .map((selector) => `${selector}:not([inert]):not([hidden])`)
  .join(',');

/** Every focusable descendant, in document order. Pure over a queried list. */
export function focusableIn(root: { querySelectorAll(selector: string): ArrayLike<Element> }): Element[] {
  return Array.from(root.querySelectorAll(FOCUSABLE_SELECTOR));
}

/**
 * Where `Tab` goes from `current`, wrapping at both ends.
 *
 * `current` of -1 means focus is somewhere the trap does not own (the browser
 * chrome, or an element that was removed), and the answer is the first element
 * forwards and the last backwards, which is what puts focus back inside.
 */
export function nextFocusIndex(current: number, total: number, backwards: boolean): number {
  if (total <= 0) return -1;
  if (current < 0) return backwards ? total - 1 : 0;
  if (backwards) return current === 0 ? total - 1 : current - 1;
  return current === total - 1 ? 0 : current + 1;
}

/**
 * Mark everything outside `element` inert, and return the undo.
 *
 * It walks from the element to `<body>` and inerts each ancestor's SIBLINGS,
 * which is how a surface that renders INLINE (no portal, because `./ui` does not
 * import react-dom) still takes the whole page out of the accessibility tree and
 * out of tab order. Only elements this call changed are restored, so two nested
 * surfaces cannot un-inert each other's background.
 */
function inertBackground(element: Element): () => void {
  const changed: Element[] = [];
  let node: Element | null = element;
  while (node && node.parentElement) {
    const parent: Element = node.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node) continue;
      if (sibling.hasAttribute('inert')) continue;
      sibling.setAttribute('inert', '');
      changed.push(sibling);
    }
    node = parent;
  }
  return () => {
    for (const sibling of changed) sibling.removeAttribute('inert');
  };
}

/**
 * Hide the page's scrollbar without shifting the layout.
 *
 * Removing the scrollbar narrows the viewport, so every centred element jumps
 * left by its width. Padding the body by exactly that width holds everything
 * still. The compensation is zero on a phone and on any overlay scrollbar, which
 * is why it is measured rather than assumed.
 */
function lockScroll(): () => void {
  const body = document.body;
  const previousOverflow = body.style.overflow;
  const previousPadding = body.style.paddingRight;
  const compensation = window.innerWidth - document.documentElement.clientWidth;
  body.style.overflow = 'hidden';
  if (compensation > 0) body.style.paddingRight = `${compensation}px`;
  return () => {
    body.style.overflow = previousOverflow;
    body.style.paddingRight = previousPadding;
  };
}

export interface ModalSurfaceOptions {
  open: boolean;
  onClose: () => void;
  /** The surface's own root. Everything outside it is inerted while open. */
  surfaceRef: React.RefObject<HTMLElement | null>;
  /** Where focus lands on open. Defaults to the surface itself. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}

export function useModalSurface({
  open,
  onClose,
  surfaceRef,
  initialFocusRef,
}: ModalSurfaceOptions): void {
  // The handler is read through a ref so the effect does not re-run, and
  // therefore does not tear down and rebuild the trap, on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!open || !surface) return;

    const opener = document.activeElement as HTMLElement | null;
    const releaseInert = inertBackground(surface);
    const releaseScroll = lockScroll();

    const target = initialFocusRef?.current ?? (focusableIn(surface)[0] as HTMLElement | undefined) ?? surface;
    target.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusableIn(surface) as HTMLElement[];
      if (items.length === 0) {
        // Nothing to move to, so the surface itself keeps focus rather than
        // letting Tab walk into the inerted page.
        event.preventDefault();
        surface.focus({ preventScroll: true });
        return;
      }
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = nextFocusIndex(current, items.length, event.shiftKey);
      event.preventDefault();
      items[next]?.focus({ preventScroll: true });
    };

    surface.addEventListener('keydown', onKeyDown);
    return () => {
      surface.removeEventListener('keydown', onKeyDown);
      releaseScroll();
      releaseInert();
      // Focus goes back to whatever opened the surface. Without this a keyboard
      // user lands at the top of the document after every close.
      if (opener && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
    };
  }, [open, surfaceRef, initialFocusRef]);
}
