'use client';

/**
 * The provider, for interactive descendants only.
 *
 * The shell header, the footer and every table are SERVER components taking
 * `brand` as a prop, so this provider's job is the narrow set of `'use client'`
 * files that cannot receive props from a server parent through several layers:
 * the finding drawer, the filter chips, the command palette. A page that renders
 * no such component needs no provider at all.
 *
 * **Every value crossing into `./client` is JSON.** `Brand` is JSON by
 * construction (no functions, no Date, no class instances) and `PoweredByResult`
 * is three scalars, which is why both are props. `t` and `feature` are built
 * INSIDE the provider: a function cannot cross the RSC boundary, so a server
 * layout passing them would fail at first render, hard, not degraded.
 */
import { createContext, createElement, useContext, useEffect, useMemo } from 'react';
import type React from 'react';

import type { Brand } from './brand';
import { feature, type FeatureKey } from './features';
import type { PoweredByResult } from './powered-by';
import { resolveBrandColors } from './tokens';
import { vocabulary, type VocabularyKey } from './vocabulary';

export interface BrandProviderProps {
  brand: Brand;
  /** Precomputed server side so the client never needs the registry. */
  poweredBy: PoweredByResult;
  children: React.ReactNode;
}

export interface BrandContextValue {
  brand: Brand;
  poweredBy: PoweredByResult;
  /** Pre-bound, so a component writes `t('finding')` and not `t(brand, 'finding')`. */
  t: (key: VocabularyKey) => string;
  feature: (key: FeatureKey) => boolean;
}

const BrandContext = createContext<BrandContextValue | null>(null);

export function BrandProvider(props: BrandProviderProps): React.JSX.Element {
  const value = useMemo<BrandContextValue>(
    () => ({
      brand: props.brand,
      poweredBy: props.poweredBy,
      t: vocabulary(props.brand),
      feature: (key: FeatureKey) => feature(props.brand, key),
    }),
    [props.brand, props.poweredBy],
  );
  return createElement(BrandContext.Provider, { value }, props.children);
}

export function useBrand(): BrandContextValue {
  const value = useContext(BrandContext);
  if (value === null) {
    throw new Error(
      'useBrand() was called outside a <BrandProvider>. Wrap the interactive subtree in the ' +
        'signed-in layout, or take `brand` as a prop from a server parent, which is what the ' +
        'chrome and the tables do.',
    );
  }
  return value;
}

/**
 * Re-apply the brand's theme colour after a theme change.
 *
 * Only needed by an app that keeps redstyle's `ThemeProvider` for its toggle:
 * `applyTheme` hard-codes the PWA `theme-color` to two literals that ignore the
 * brand and rewrites every matching meta tag on every change.
 */
export function useBrandThemeColor(brand: Brand): void {
  useEffect(() => {
    const apply = (): void => {
      const scheme = document.documentElement.classList.contains('light') ? 'light' : 'dark';
      const color = resolveBrandColors(brand, scheme)['bg-primary' as 'bg-primary'];
      for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
        meta.setAttribute('content', color as string);
      }
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [brand]);
}
