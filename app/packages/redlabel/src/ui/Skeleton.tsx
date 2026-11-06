import type React from 'react';

/**
 * The loading placeholder, and redstyle leak 1's workaround.
 *
 * redstyle DOES export `Skeleton`, and its `.skeleton` class mixes
 * `rgba(239, 68, 68, 0.06)` into the shimmer (`base.css:143`), so every loading
 * surface in every product shimmers redbtn red. This one carries `rl-skeleton`,
 * whose wash is `color-mix(in srgb, var(--accent) 6%, transparent)` and therefore
 * follows the brand.
 *
 * The class name has to DIFFER, not just the declarations: `base.css` also ships
 * `.light .skeleton` at (0,2,0), which beats a local `.skeleton` at (0,1,0), so a
 * tokenized copy under the same name would be correct in dark and silently lose
 * to the hardcoded red in light.
 *
 * A SERVER component with no directive: it is a `<span>` and a class name.
 *
 * It is `aria-hidden` and carries no text. A placeholder is not information, and
 * a screen reader that announces one reads a wall of nothing; the surface around
 * it owns the `aria-busy` and the one polite live line.
 */
export interface SkeletonProps {
  /** Any CSS length. Defaults to full width, which is what a text line wants. */
  width?: string | number;
  height?: string | number;
  /** `full` for an avatar or a dot, `lg` for a control, `md` for a line. */
  radius?: 'md' | 'lg' | 'full';
  className?: string;
}

const RADIUS: Readonly<Record<NonNullable<SkeletonProps['radius']>, string>> = {
  md: 'rounded',
  lg: 'rounded-lg',
  full: 'rounded-full',
};

export function Skeleton({
  width = '100%',
  height = '1rem',
  radius = 'md',
  className,
}: SkeletonProps): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={['rl-skeleton block', RADIUS[radius], className].filter(Boolean).join(' ')}
      style={{ width, height }}
    />
  );
}
