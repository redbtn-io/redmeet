/**
 * The two React elements the root layout renders, and the props helper for
 * `<html>`.
 *
 * Both are SERVER SAFE: no hooks, no `'use client'`, so a server layout renders
 * them directly and neither drags the brand registry into a client graph.
 */
import type React from 'react';

import type { Brand } from './brand';
import { brandStyle, resolveBrandColors, themeStyleCss, type ThemeScope } from './tokens';

/**
 * `style` plus `data-brand` for `<html>`, or for the org-rebrand wrapper.
 *
 * `React.CSSProperties` is the wrong return type for `brandStyle` and does not
 * compile: `@types/react` removed the index signature to enable closed typing
 * through CSSType, so an object of custom properties fails under `--strict`. `.`
 * therefore owns its own `CssVarMap` shape and the single type assertion lives
 * here, in the helper that exists to own it.
 */
export function brandStyleProps(brand: Brand): {
  style: React.CSSProperties;
  'data-brand': string;
} {
  return { style: brandStyle(brand) as React.CSSProperties, 'data-brand': brand.id };
}

export function ThemeStyle(props: {
  brand: Brand;
  scope?: ThemeScope;
  nonce?: string;
}): React.JSX.Element | null {
  const css = themeStyleCss(props.brand, props.scope ? { scope: props.scope } : undefined);
  if (css === '') return null;
  return <style nonce={props.nonce} dangerouslySetInnerHTML={{ __html: css }} />;
}

/**
 * The inline theme boot script, as a CONSTANT string.
 *
 * It is constant on purpose. A CSP hashes the script TEXT, so interpolating a
 * brand's colours into the source would give every brand a different hash and
 * `script-src` could name only one of them. The two surface colours arrive as
 * `data-` attributes instead, which a hash does not cover, so one hash serves
 * every brand for ever.
 *
 * What it does, synchronously in `<head>`, before first paint: read the stored
 * theme, put `dark` or `light` on `<html>` with a matching `colorScheme`, and
 * set `content` on `meta[name="theme-color"]` from this brand's two surfaces.
 * Together with the literal `dark` class the layout server-renders, that
 * guarantees a scheme class is on `<html>` in the first byte of HTML and at
 * every moment after, which is what every selector `themeStyleCss` emits
 * depends on.
 *
 * `redstyle`'s own `ThemeProvider` is NOT used for this: it returns null until
 * mounted, which blanks the first paint, and it hard-codes the theme colour to
 * two literals that ignore the brand.
 */
export const THEME_BOOT_SCRIPT =
  "(function(){try{var s=document.currentScript;if(!s)return;var d=s.getAttribute('data-rl-dark')||'';var l=s.getAttribute('data-rl-light')||'';var k=s.getAttribute('data-rl-key')||'redstyle-theme';var t=null;try{t=window.localStorage.getItem(k);}catch(e){}if(t!=='light'&&t!=='dark'){t='dark';}var r=document.documentElement;r.classList.remove('light','dark');r.classList.add(t);r.style.colorScheme=t;var c=t==='light'?l:d;if(c){var m=document.querySelector('meta[name=\"theme-color\"]');if(!m){m=document.createElement('meta');m.setAttribute('name','theme-color');document.head.appendChild(m);}m.setAttribute('content',c);}}catch(e){}})();";

export function BrandThemeScript(props: {
  brand: Brand;
  storageKey?: string;
  nonce?: string;
}): React.JSX.Element {
  const dark = resolveBrandColors(props.brand, 'dark');
  const light = resolveBrandColors(props.brand, 'light');
  return (
    <script
      data-rl-dark={dark['bg-primary' as keyof typeof dark]}
      data-rl-light={light['bg-primary' as keyof typeof light]}
      data-rl-key={props.storageKey ?? 'redstyle-theme'}
      nonce={props.nonce}
      dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }}
    />
  );
}
