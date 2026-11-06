import fs from 'node:fs';
import path from 'node:path';
import type { NextConfig } from 'next';

// The tracing root MUST be the repo root or `output: standalone` silently drops
// packages/core and packages/redlabel from the bundle, and the container fails
// at RUNTIME rather than at build.
//
// `process.cwd()` is correct here: npm runs a workspace script with cwd set to
// that workspace, so `npm run build -w web` from the repo root gives
// cwd = <repo>/web.
const repoRoot = path.join(process.cwd(), '..');

// A wrong tracing root fails only at container start, as a missing module. Make
// it fail at BUILD instead.
if (!fs.existsSync(path.join(repoRoot, 'packages/core/package.json'))) {
  throw new Error(
    `outputFileTracingRoot resolved to ${repoRoot}, which is not the redmeet repo root. ` +
      'Run the build as `npm run build -w web` from the repo root.',
  );
}

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: repoRoot,
  turbopack: { root: repoRoot },
  // Internal packages export TypeScript source and are compiled by their consumer.
  transpilePackages: ['@redmeet/core', '@redbtn/redlabel'],
  serverExternalPackages: [
    // SEAM, load bearing rather than tidy (mirrors redscan's config, where
    // this failure was first diagnosed).
    //
    // `@redbtn/redstyle/dist/tokens.js` carries a top-level `'use client'`
    // although it is pure data. Next honours that directive inside
    // node_modules, so a SERVER import of it yields client REFERENCES rather
    // than the objects, and redLabel derives `COLOR_TOKEN_NAMES` at module
    // load with `Object.keys(darkTokens)`. In the server build that list
    // comes out empty, `tokenNameSchema` becomes an enum of no names, and
    // `createRegistry` then refuses every brand that declares a token
    // override:
    //
    //   Error: redlabel: brand at index 3 ("medshield") is invalid:
    //     tokens.shared  Unrecognized key: "accent"
    //
    // which fails `next build` outright. It is invisible for brands that
    // override no tokens (an empty name list validates them fine), which is
    // why the redMeet and redbtn brands alone would never have shown it.
    //
    // Marking the package external makes the server load it through Node,
    // so the data is data again. It affects the server graph only; client
    // components still bundle redstyle normally. The deeper fix belongs
    // upstream (drop the directive from redstyle's token module,
    // redlabel.md 4.9) or in redLabel (stop deriving the name list at
    // runtime), and this line comes out when either lands.
    '@redbtn/redstyle',
  ],
};

export default nextConfig;
