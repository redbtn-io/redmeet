import type React from 'react';

import type { Brand } from '../brand';
import { BrandMark } from './BrandMark';

/**
 * The full-surface brand moment, and redstyle leak 7's workaround.
 *
 * redstyle's `SplashScreen` embeds a 160px base64 redbtn disc in the bundle
 * (`components/SplashScreen.tsx`), so a reseller's splash shows somebody else's
 * button. Never import it. This renders `brand.logo.markUrl`, which is the
 * resolved brand's own committed PNG.
 *
 * It is also the product's ONE marked wait. Every sandbox checkout is cold and
 * the measured spawn is about a minute, so redScan has exactly one unavoidable
 * wait with no fact behind it, and it is drawn with the mark and an elapsed
 * count rather than with a spinner. `Loader2` is imported nowhere in the estate
 * for the same reason: a spinning loader is the generic security-tool gesture,
 * and everything else the product waits on is a fact it already holds.
 *
 * A SERVER component with no directive. The elapsed counter is the CALLER's, and
 * that is deliberate: a ticking number is client state, and pushing it in here
 * would drag the whole splash across the boundary. The caller passes it as
 * `detail`.
 */
export interface BrandSplashProps {
  brand: Brand;
  /** The one line under the mark. "Preparing sandbox. This takes about a minute." */
  message?: string;
  /** An elapsed count or a progress fact, rendered in `tabular-nums` beside the message. */
  detail?: React.ReactNode;
  /** Rendered mark size. 40 in the inline moment, 64 on a full page. */
  size?: number;
  /** `false` when the splash sits inside a card rather than owning the viewport. */
  fullscreen?: boolean;
  className?: string;
}

export function BrandSplash({
  brand,
  message,
  detail,
  size = 64,
  fullscreen = true,
  className,
}: BrandSplashProps): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className={[
        'flex flex-col items-center justify-center gap-3 text-center',
        fullscreen ? 'min-h-dvh' : 'py-8',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* The ping ring is a decoration on a fact the message states, so it is
          hidden from assistive technology and stops under reduced motion. */}
      <span className="relative inline-flex">
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-ping rounded-full bg-[color-mix(in_srgb,var(--accent)_28%,transparent)] motion-reduce:animate-none"
        />
        <BrandMark brand={brand} size={size} className="relative" />
      </span>
      {message !== undefined ? (
        <p className="text-sm text-text-secondary">{message}</p>
      ) : (
        <span className="sr-only">{brand.product.name}</span>
      )}
      {detail !== undefined ? (
        <p className="text-xs tabular-nums text-text-muted">{detail}</p>
      ) : null}
    </div>
  );
}
