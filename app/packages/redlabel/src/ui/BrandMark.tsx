import type React from 'react';

import type { Brand } from '../brand';

/**
 * The square mark.
 *
 * A SERVER component with no directive: it is a pure function of its props, so
 * nothing forced it across the boundary. It takes `brand` as a required prop and
 * reads no context, which is what lets the shell header stay a server subtree.
 *
 * A plain `<img>`, never `next/image`: `./ui` must stay usable without Next, and
 * the mark is a committed same-origin PNG drawn at 16 to 40 px, where the
 * optimizer buys nothing. `logo.markSize` documents which committed file
 * `markUrl` points at; the rendered size comes from `size`.
 *
 * The glow is a brand FLAG, and its colour is derived from `--accent` rather
 * than hardcoded, so a flat reseller logo does not get a red halo that reads as
 * a rendering bug.
 */
export interface BrandMarkProps {
  brand: Brand;
  /** Rendered pixel size. The shell uses 28. */
  size?: number;
  className?: string;
}

export function BrandMark({ brand, size = 28, className }: BrandMarkProps): React.JSX.Element {
  const glow = brand.logo.glow
    ? 'shadow-[0_0_16px_color-mix(in_srgb,var(--accent)_45%,transparent)]'
    : '';
  return (
    <span
      aria-hidden="true"
      className={['inline-flex shrink-0 items-center justify-center rounded-full', glow, className]
        .filter(Boolean)
        .join(' ')}
      style={{ width: size, height: size }}
    >
      <img
        src={brand.logo.markUrl}
        width={size}
        height={size}
        decoding="async"
        fetchPriority="high"
        alt=""
        className="block h-full w-full"
      />
    </span>
  );
}
