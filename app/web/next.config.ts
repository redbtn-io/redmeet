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
  turbopack: {},
};

export default nextConfig;
