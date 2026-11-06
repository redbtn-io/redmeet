import type React from 'react';

import type { Brand } from '../brand';
import { splitWordmark } from '../wordmark';

/**
 * The product name, split when the brand states a prefix.
 *
 * A SERVER component with no directive, taking `brand` as a required prop.
 *
 * Rendering follows the launcher: the prefix in `--text-primary`, the suffix in
 * `--accent-text`, with redstyle TOKEN names rather than a private `--brand` /
 * `--ink` vocabulary, which is exactly the fork redLabel exists to stop. The
 * wrapper carries the `aria-label` and both halves are `aria-hidden`, so a
 * screen reader reads the product name once.
 *
 * `variant="short"` (the default) renders `product.short`, which exists
 * precisely for tight chrome: a reseller's `product.name` can be 24 characters
 * and the phone header is verified at 390px.
 */
export interface WordmarkProps {
  brand: Brand;
  variant?: 'short' | 'full';
  className?: string;
}

export function Wordmark({ brand, variant = 'short', className }: WordmarkProps): React.JSX.Element {
  const text = variant === 'full' ? brand.product.name : brand.product.short;

  if (brand.logo.wordmarkUrl !== null) {
    return (
      <img
        src={brand.logo.wordmarkUrl}
        alt={brand.product.name}
        decoding="async"
        className={['h-[1.3em] w-auto', className].filter(Boolean).join(' ')}
      />
    );
  }

  const parts = splitWordmark(text, brand.product.wordmarkPrefix);
  if ('plain' in parts) {
    return (
      <span
        aria-label={text}
        className={['font-semibold tracking-tight text-text-primary', className]
          .filter(Boolean)
          .join(' ')}
      >
        <span aria-hidden="true">{parts.plain}</span>
      </span>
    );
  }

  return (
    <span
      aria-label={text}
      className={['font-semibold tracking-tight', className].filter(Boolean).join(' ')}
    >
      <span aria-hidden="true" className="text-text-primary">
        {parts.prefix}
      </span>
      <span aria-hidden="true" className="text-accent-text">
        {parts.suffix}
      </span>
    </span>
  );
}
