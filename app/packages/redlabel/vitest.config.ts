import path from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * Every test in this package is pure: no database, no network, no filesystem
 * outside the package, no environment. That is a rule, not a coincidence, and it
 * is what lets `npm test` pass in an extracted redLabel with no app present.
 *
 * The two checks that walk the APP's source (no-hex, feature-key coverage) are
 * repo-root scripts, never vitest files in here.
 */
export default defineConfig({
  resolve: {
    alias: {
      // `server-only` resolves to its throwing client build outside a React
      // Server Component graph. Vitest already runs in Node, so stub it.
      'server-only': path.resolve(import.meta.dirname, './test/stubs/server-only.ts'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    globals: false,
    testTimeout: 10_000,
  },
});
