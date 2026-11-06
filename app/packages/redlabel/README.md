# @redbtn/redlabel

Brand resolution, runtime theming and themable primitives for redbtn products. One place a product is
taught to wear somebody else's face: a validated `Brand` record, host resolution, two CSS emitters, the
primitives redstyle does not ship, and four Next helpers.

Nothing in a `Brand` is a secret, a credential, an org id or an authority. That is the invariant that
lets a brand be resolved from an attacker-controlled request header.

`docs/specs/redlabel.md` in `redbtn-io/redscan` is the specification. This file is what a second product
does to adopt it.

## Adopting it

1. `npm i @redbtn/redlabel` and `npx redlabel-icons --copy redbtn --out public/brand`. That second
   command is a COPY, not a render, so it needs no `sharp`. Without it the default brand's own
   `logo.markUrl` 404s in any repo but redScan's.
2. In `globals.css`, after redstyle's `base.css`:
   ```css
   @import "@redbtn/redlabel/styles.css";
   @source "../../../node_modules/@redbtn/redstyle/dist";
   @source "../../../packages/redlabel/src";
   ```
   **Count the levels up.** A hoisted monorepo `node_modules` is three from `src/app/globals.css`, a
   standalone repo is two, and a wrong `@source` path fails SILENTLY: it drops every redstyle class from
   the stylesheet with no error at all.
3. In a server-only module, once, at module scope: `configureBrand({ registry: REGISTRY, store: null })`.
   `getBrand()` takes zero arguments so one request is one cache entry and one store read.
4. In the root layout: `brandStyleProps(brand)` and the literal `dark` class on `<html>`,
   `<ThemeStyle brand={brand} />` and `<BrandThemeScript brand={brand} />` in `<head>`,
   `brandMetadata(brand)` and `brandViewport(brand)` as the metadata exports.
5. Set `REDSCAN_DEFAULT_BRAND_ID` (or your product's equivalent) on every deployment, and call
   `assertDeploymentBrand(process.env)` and `assertDeploymentAuth(REGISTRY, process.env)` on the first
   request, never at module load. RedRun's runtime env does not exist during `next build`, so a
   module-load throw is a red Docker build rather than a caught misconfiguration.
6. Exclude the brand assets from your edge gate. The matcher is exhaustive and it is not optional:
   ```
   '/((?!_next/static|_next/image|brand/|favicon\\.ico|apple-touch-icon\\.png|manifest\\.webmanifest|robots\\.txt).*)'
   ```
   Without `brand/` and `apple-touch-icon.png` the gate 302s a signed-out visitor's brand mark and the
   iOS touch icon to your sign-in host: a broken image on the landing page and an uninstallable PWA, for
   the default brand as much as for a reseller's.

## The entry points, and which side of the boundary each is on

| Import | What it is | Never |
|---|---|---|
| `@redbtn/redlabel` | pure: the schema, resolution, tokens, vocabulary, features, export identity, chart palettes | react, next, node builtins, `process.env` |
| `@redbtn/redlabel/theme` | `<ThemeStyle>`, `<BrandThemeScript>`, `brandStyleProps` (server safe, no hooks) | the registry, hooks |
| `@redbtn/redlabel/server` | `getBrand`, `configureBrand`, the store port (`import 'server-only'`) | the UI, any db driver |
| `@redbtn/redlabel/client` | `<BrandProvider>`, `useBrand`, `useBrandThemeColor` | the registry, next server APIs |
| `@redbtn/redlabel/ui` | every component below, each carrying its own directive or not | the registry, `next/image` |
| `@redbtn/redlabel/ui/client` | `BrandMarkLive`, `WordmarkLive`, `PoweredByLive`, `DataTableInteractive` | the registry |
| `@redbtn/redlabel/ui/charts` | `Donut`, `Sparkline`, `StackedBar`, `HeatStrip`, `SeriesSwatch` | a chart library |
| `@redbtn/redlabel/next` | `brandMetadata`, `brandViewport`, `brandManifest`, `brandIcons`, `brandAssetHosts`, `brandFontLinks` | react, the filesystem |
| `@redbtn/redlabel/brands` | the static registry (`import 'server-only'`) | a client graph |
| `@redbtn/redlabel/presentation` | the client-safe presentation subset, for `global-error.tsx` | a brand file |
| `@redbtn/redlabel/styles.css` | the handwritten rules Tailwind cannot emit from a class name | |

**`./brands` is server and build only, and `server-only` is the enforcement rather than a convention.** A
client component that imported the registry would ship every brand's config (support email, install URL,
legal text, every reseller's colours) to every browser.

**`'use client'` lives on the file, never on the barrel.** `./ui` is a plain re-export: a directive there
would make `BrandMark`, `Wordmark`, `PoweredBy` and `DataTable` un-renderable on the server, and the
chrome and every table are server components by contract. Inside a client component, deep-import
(`@redbtn/redlabel/ui/BottomSheet`) so a page that wants one sheet does not drag the tooltip and the
charts into its graph.

| Server safe (no directive) | `'use client'` |
|---|---|
| `DataTable`, `BrandMark`, `Wordmark`, `PoweredBy`, `Skeleton`, `LivePulse`, `DangerButton`, `BrandSplash`, `Donut`, `Sparkline`, `StackedBar`, `HeatStrip`, `ThemeStyle`, `BrandThemeScript` | `BottomSheet`, `Drawer`, `Tooltip`, `InfoTip`, `DataTableInteractive`, `BrandProvider` |

`Drawer` is `BottomSheet`: one implementation, two presentations, a sheet below `md` and a right-side
drawer above it. It carries a real focus trap, `Escape`, focus restored to the opener, `inert` on the
background and a scroll lock that does not shift layout, which is why a confirmation dialog belongs on it
rather than on redstyle's `Dialog`.

## The redstyle leaks, and what to use instead

Each of these hardcodes redbtn red regardless of the brand. `scripts/check-no-hex.mjs` fails the build on
every one of them.

| Leak | Use |
|---|---|
| `.skeleton` shimmers `rgba(239,68,68,0.06)` | `<Skeleton>` (`rl-skeleton`) |
| `@keyframes streaming-pulse` glows red | `<LivePulse>` (`rl-streaming-pulse`) |
| `Button variant="destructive"` is `bg-red-600 text-white` | `<DangerButton>` |
| `SplashScreen` embeds a base64 redbtn disc | `<BrandSplash>` |
| `useTheme.applyTheme` hardcodes `theme-color` | `<BrandThemeScript>` plus `brandViewport` |
| `compat.css` `.compat-deck` resets `--accent` | do not import `compat.css` |
| `tokens.ts` `BRAND_RED`, `getToken`, `chartSeriesHex` | `resolveBrandColors(brand, scheme)` |

A locally tokenized copy under the SAME class name does not work: `base.css` ships `.light .skeleton` and
`.light .streaming-pulse` at (0,2,0), which beats a local `.skeleton` at (0,1,0), so the copy is correct
in dark and silently loses to the hardcoded red in light. The `rl-` prefix is how they stay different.

## Adding a brand

1. Write `src/brands/<id>.ts`. State only what differs: `createRegistry` fills `email.appName`,
   `export.toolName`, `export.toolInformationUri` and `export.organization` from the product, the origin
   and the company.
2. Drop `assets/<id>/logo.png`, record its md5 in `assets/<id>/PROVENANCE.md`, run
   `npm run icons -- --brand <id>`, and commit `web/public/brand/<id>/`, `assets/<id>/generated/` and the
   updated `brand-icons.lock.json`. CI runs `--check`, never the generator, and `sharp` is not a
   dependency of this package at any level.
3. Add the id to `src/brands/index.ts` and its presentation row to `src/brands/presentation.ts` (a test
   asserts the row equals the projection, so drift is a red suite rather than a wrong colour).
4. Expect the contrast gate to refuse one accent for both schemes. It usually will: an accent that reads
   on a dark page rarely clears 3.0 on a light one. State a darker accent under `light` in the brand file.
   There is no flag to turn the gate off.

Everything a brand states is presentation. `auth`, `hosts`, `id`, `origin`, `billing.productKey` and
`githubApp.appSlug` can never be changed by the `brands` collection, because they are deployment and
security facts baked into the container's env and its DNS.

## Extraction

The seam that makes it free is the import specifier, which is `@redbtn/redlabel` from the first line of
code. `docs/specs/redlabel.md` section 1.5 is the checklist: `git subtree split`, `"private": false`, add
a `tsup` build with one entry per export PATH and `preserveDirectives`, register with redSync, and
consume it from `registry.redbtn.io` pinned exact. `npm test` inside this package already passes with no
app present: every test is pure, and the two checks that walk `web/src` are repo-root scripts.
