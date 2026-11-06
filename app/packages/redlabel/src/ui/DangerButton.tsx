import type React from 'react';

/**
 * The destructive action, and redstyle leak 3's workaround.
 *
 * redstyle's `Button variant="destructive"` is `bg-red-600 text-white
 * hover:bg-red-700` (`components/Button.tsx:17`): the TAILWIND PALETTE, not a
 * token, so it ignores the brand and it ignores `--error` too. Never write
 * `variant="destructive"`; CI greps for it and fails.
 *
 * `bg-error text-accent-foreground` is NOT the replacement. In dark that renders
 * `#ffffff` on `#f87171`, which measures **2.77**: worse than the leak it
 * replaces (`bg-red-600 text-white` is 4.83) and below even the 3.0 non-text
 * floor. The fill and the label both come from `rl-danger-button`, whose colour
 * is the DERIVED `--error-foreground`: black in dark at 7.59, white in light at
 * 6.47, and the contrast gate checks that exact pair on every brand.
 *
 * A SERVER component with no directive. A destructive control is almost always
 * inside a confirmation the app already owns, and a button that submits a form or
 * links somewhere needs no client boundary; a caller that needs `onClick` passes
 * it from its own client component, which works because this file adds no
 * directive of its own.
 */
export interface DangerButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 'sm' | 'md';
}

const SIZE: Readonly<Record<NonNullable<DangerButtonProps['size']>, string>> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
};

export function DangerButton({
  size = 'md',
  className,
  type = 'button',
  children,
  ...rest
}: DangerButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      type={type}
      className={[
        'rl-danger-button tap inline-flex items-center justify-center gap-1.5 rounded-lg border',
        'font-medium transition-colors',
        'focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none',
        SIZE[size],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </button>
  );
}
