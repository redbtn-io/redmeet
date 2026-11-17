/**
 * Background blur runs MediaPipe's selfie segmenter in the browser
 * (@livekit/track-processors). By default that library pulls its
 * wasm from jsDelivr and its model from Google storage, which the
 * CSP forbids and which would hand every participant's IP to two
 * third parties on every meeting. So both are self hosted:
 *
 *  - the model (~250 KB) is committed at public/mediapipe/;
 *  - the wasm (~9 MB per variant) is copied here from the installed
 *    @mediapipe/tasks-vision at build time, so it always matches the
 *    JS that loads it and never bloats the repo.
 *
 * Runs as `prebuild` and `predev`. Fails loudly if the package is
 * missing: a build without the wasm would ship a blur toggle that
 * can never work.
 */
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function findWasmDir() {
  let dir = webDir;
  for (;;) {
    const candidate = join(dir, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

const source = findWasmDir();
if (!source) {
  console.error('copy-mediapipe: @mediapipe/tasks-vision/wasm not found in any node_modules');
  process.exit(1);
}
const target = join(webDir, 'public', 'mediapipe', 'wasm');
mkdirSync(target, { recursive: true });
for (const file of readdirSync(source)) {
  if (/^vision_wasm_(nosimd_)?internal\.(js|wasm)$/.test(file)) {
    cpSync(join(source, file), join(target, file));
  }
}
console.log(`copy-mediapipe: ${source} -> public/mediapipe/wasm`);
