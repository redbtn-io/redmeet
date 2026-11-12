import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${path.join(here, 'src')}/$1` },
      // The lib modules are server code; in tests they run in plain
      // Node, where the real 'server-only' marker package throws.
      { find: /^server-only$/, replacement: path.join(here, 'test/server-only-stub.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
