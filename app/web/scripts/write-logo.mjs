// Writes the canonical redbtn logo PNG into public/icons/ at Docker build
// time. The redRun workspace push is text-only (binaries are skipped), so
// the logo travels as base64 text and is materialized here — the same
// pattern redBuild uses for its generated PWA icons.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = `${here}/../public/icons/redbtn-logo.png`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(readFileSync(`${here}/redbtn-logo.b64`, 'utf8').trim(), 'base64'));
console.log('wrote', out);
