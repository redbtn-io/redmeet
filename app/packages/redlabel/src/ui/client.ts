'use client';

/**
 * The context-reading and handler-taking wrappers.
 *
 * `BrandMark`, `Wordmark` and `PoweredBy` take `brand` as a REQUIRED prop and
 * read no context, because the shell header, the footer and every table are
 * server components and a required prop is what keeps them there. These three
 * wrappers exist for the other case: a genuinely interactive subtree, several
 * layers below a `<BrandProvider>`, where threading `brand` through every
 * intermediate component would be worse than a context read.
 *
 * They are written with `createElement` rather than JSX so this file can stay
 * `.ts`, which is what `package.json` maps `./ui/client` to.
 */
import { createElement } from 'react';
import type React from 'react';

import { useBrand } from '../client';
import { BrandMark, type BrandMarkProps } from './BrandMark';
import { PoweredBy, type PoweredByProps } from './PoweredBy';
import { Wordmark, type WordmarkProps } from './Wordmark';

export type BrandMarkLiveProps = Omit<BrandMarkProps, 'brand'>;
export type WordmarkLiveProps = Omit<WordmarkProps, 'brand'>;
export type PoweredByLiveProps = Omit<PoweredByProps, 'poweredBy'>;

export function BrandMarkLive(props: BrandMarkLiveProps): React.JSX.Element {
  const { brand } = useBrand();
  return createElement(BrandMark, { ...props, brand });
}

export function WordmarkLive(props: WordmarkLiveProps): React.JSX.Element {
  const { brand } = useBrand();
  return createElement(Wordmark, { ...props, brand });
}

export function PoweredByLive(props: PoweredByLiveProps): React.JSX.Element | null {
  const { poweredBy } = useBrand();
  return createElement(PoweredBy, { ...props, poweredBy });
}

export {
  DataTableInteractive,
  type DataTableInteractiveProps,
} from './DataTableInteractive';
