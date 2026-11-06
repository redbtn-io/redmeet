import type React from 'react';

import type { PoweredByResult } from '../powered-by';

/**
 * The reseller attribution, taking the PRECOMPUTED result as a required prop.
 *
 * A server component with no directive: `poweredBy(brand, registry)` needs the
 * registry, which is server and build only, so the value is computed on the
 * server and the component renders it. A brand with `reseller: null` (redbtn
 * itself) renders nothing.
 */
export interface PoweredByProps {
  poweredBy: PoweredByResult;
  className?: string;
}

export function PoweredBy({ poweredBy, className }: PoweredByProps): React.JSX.Element | null {
  if (!poweredBy.show) return null;
  return (
    <a
      href={poweredBy.href}
      rel="noreferrer"
      target="_blank"
      className={['text-xs text-text-muted hover:text-text-secondary', className]
        .filter(Boolean)
        .join(' ')}
    >
      {poweredBy.text}
    </a>
  );
}
