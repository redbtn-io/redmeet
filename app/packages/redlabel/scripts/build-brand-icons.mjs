#!/usr/bin/env node
/**
 * Every icon a brand ships, from one 1024px master.
 *
 *   node scripts/build-brand-icons.mjs [--brand <id>] [--out <dir>] [--bg <hex>]
 *   node scripts/build-brand-icons.mjs --check
 *   node scripts/build-brand-icons.mjs --copy <id> --out <dir>
 *
 * Run by a human (or an agent) when a brand's master changes; the outputs are
 * committed. CI runs `--check`, never the generator.
 *
 * `sharp` is NOT a dependency of this package, not even a devDependency: the
 * root Dockerfile's deps stage runs plain `npm ci`, which installs every
 * workspace's devDependencies on purpose, and `--ignore-scripts` would leave a
 * native package present and non-functional. So it is resolved at CALL TIME,
 * inside the generate branch only, with
 *
 *   npm exec --yes --package=sharp@^0.34 -- node scripts/build-brand-icons.mjs
 *
 * which is this package's `npm run icons`. A top-of-file `import sharp` would
 * fail at MODULE LOAD and break `--copy` and `--check` for exactly the adopter
 * they exist for, who installed @redbtn/redlabel without devDependencies.
 *
 * The maskable icon is a separate file for a reason: the mark is a full-bleed
 * disc whose alpha touches all four edges, and Android crops a maskable icon to
 * the inner 80%, which would shave the rim off. So the maskable copy is the
 * disc inset to 80% on the brand's dark surface. The apple touch icon is
 * flattened onto the same surface because iOS does not honour transparency.
 *
 * sharp cannot write ICO, so the favicon is assembled here: a 6-byte ICONDIR, a
 * 16-byte entry per size, then the PNG payloads. PNG-in-ICO is what the rest of
 * the estate already ships and every browser since IE11 reads it.
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_FILE = path.join(PACKAGE_ROOT, 'brand-icons.lock.json');
const DEFAULT_OUT = path.resolve(PACKAGE_ROOT, '..', '..', 'web', 'public', 'brand');

/**
 * The surface the two flattened outputs sit on: the brand's own dark
 * `bg-primary`. It lives here, as one reviewable table, rather than in the
 * brand file, because this script is plain Node and must run with no TypeScript
 * toolchain and no zod. `--bg` overrides it for a one-off.
 */
const BRAND_ICON_BACKGROUND = {
  redbtn: '#0a0a0a',
  'redbtn-beta': '#0a0a0a',
  medshield: '#07101a',
};

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/** name, pixel size, and how it is produced. Section 7 of redlabel.md. */
const OUTPUTS = [
  { file: 'logo.png', size: 1024, kind: 'master' },
  { file: 'icon-512.png', size: 512, kind: 'plain' },
  { file: 'icon-maskable-512.png', size: 512, kind: 'maskable' },
  { file: 'icon-384.png', size: 384, kind: 'plain' },
  { file: 'icon-192.png', size: 192, kind: 'plain' },
  { file: 'apple-touch-icon.png', size: 180, kind: 'flattened' },
  { file: 'favicon-32x32.png', size: 32, kind: 'plain' },
  { file: 'favicon-16x16.png', size: 16, kind: 'plain' },
  { file: 'favicon.ico', size: 32, kind: 'ico' },
];

function parseArgs(argv) {
  const args = { brand: 'redbtn', out: DEFAULT_OUT, check: false, copy: null, bg: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--check') args.check = true;
    else if (flag === '--brand') args.brand = argv[(i += 1)];
    else if (flag === '--out') args.out = path.resolve(argv[(i += 1)]);
    else if (flag === '--copy') args.copy = argv[(i += 1)];
    else if (flag === '--bg') args.bg = argv[(i += 1)];
  }
  return args;
}

function md5(buffer) {
  return createHash('md5').update(buffer).digest('hex');
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/** The PNG header gives width and height in 24 bytes. ICO carries its own. */
function dimensions(file, buffer) {
  if (file.endsWith('.ico')) {
    if (buffer.length < 8 || buffer.readUInt16LE(2) !== 1) return { width: 0, height: 0 };
    const width = buffer.readUInt8(6) || 256;
    const height = buffer.readUInt8(7) || 256;
    return { width, height };
  }
  const PNG_SIGNATURE = '89504e470d0a1a0a';
  if (buffer.subarray(0, 8).toString('hex') !== PNG_SIGNATURE) return { width: 0, height: 0 };
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    alpha: 1,
  };
}

function readLock() {
  if (!existsSync(LOCK_FILE)) return {};
  return JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
}

function writeLock(lock) {
  const sorted = Object.fromEntries(Object.entries(lock).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(LOCK_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * The master's md5, as recorded in `assets/<id>/PROVENANCE.md`. A silently
 * replaced master must not propagate, so this is a hard gate rather than a
 * warning.
 */
function provenanceMd5(brand) {
  const file = path.join(PACKAGE_ROOT, 'assets', brand, 'PROVENANCE.md');
  const text = readFileSync(file, 'utf8');
  const match = /md5:\s*([0-9a-f]{32})/i.exec(text);
  if (!match) throw new Error(`${file} records no md5. Add a line "md5: <32 hex>".`);
  return match[1].toLowerCase();
}

function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const directory = [];
  for (const entry of entries) {
    const record = Buffer.alloc(16);
    record.writeUInt8(entry.size >= 256 ? 0 : entry.size, 0);
    record.writeUInt8(entry.size >= 256 ? 0 : entry.size, 1);
    record.writeUInt8(0, 2); // palette
    record.writeUInt8(0, 3); // reserved
    record.writeUInt16LE(1, 4); // planes
    record.writeUInt16LE(32, 6); // bits per pixel
    record.writeUInt32LE(entry.data.length, 8);
    record.writeUInt32LE(offset, 12);
    offset += entry.data.length;
    directory.push(record);
  }
  return Buffer.concat([header, ...directory, ...entries.map((entry) => entry.data)]);
}

async function generate(args) {
  const brand = args.brand;
  const assetsDir = path.join(PACKAGE_ROOT, 'assets', brand);
  const source = path.join(assetsDir, 'logo.png');
  const master = readFileSync(source);

  const expected = provenanceMd5(brand);
  const actual = md5(master);
  if (actual !== expected) {
    console.error(`\n${source} has md5 ${actual}; PROVENANCE.md records ${expected}.`);
    console.error('The canonical master changed. Verify it deliberately before regenerating.\n');
    process.exit(1);
  }

  const background = hexToRgb(args.bg ?? BRAND_ICON_BACKGROUND[brand] ?? '#0a0a0a');
  const { default: sharp } = await import('sharp');

  const plain = (size) =>
    sharp(source)
      .resize(size, size, { fit: 'contain', background: TRANSPARENT, kernel: 'lanczos3' })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();

  const flattened = (size) =>
    sharp(source)
      .resize(size, size, { fit: 'contain', background: TRANSPARENT, kernel: 'lanczos3' })
      .flatten({ background })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();

  const maskable = async (size) => {
    const inner = Math.round(size * 0.8);
    const disc = await sharp(source)
      .resize(inner, inner, { fit: 'contain', background: TRANSPARENT, kernel: 'lanczos3' })
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
    const offset = Math.round((size - inner) / 2);
    return sharp({ create: { width: size, height: size, channels: 4, background } })
      .composite([{ input: disc, top: offset, left: offset }])
      .png({ compressionLevel: 9, palette: false })
      .toBuffer();
  };

  const generatedDir = path.join(assetsDir, 'generated');
  const outDir = path.join(args.out, brand);
  mkdirSync(generatedDir, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  const lock = readLock();
  for (const output of OUTPUTS) {
    let data;
    if (output.kind === 'master') data = master;
    else if (output.kind === 'plain') data = await plain(output.size);
    else if (output.kind === 'flattened') data = await flattened(output.size);
    else if (output.kind === 'maskable') data = await maskable(output.size);
    else {
      const sizes = [16, 32];
      const payloads = await Promise.all(sizes.map((size) => plain(size)));
      data = ico(sizes.map((size, index) => ({ size, data: payloads[index] })));
    }
    writeFileSync(path.join(generatedDir, output.file), data);
    writeFileSync(path.join(outDir, output.file), data);
    const { width, height } = dimensions(output.file, data);
    lock[`${brand}/${output.file}`] = { sha256: sha256(data), width, height, bytes: data.length };
    console.log(`${brand}/${output.file}  ${width}x${height}  ${data.length} bytes`);
  }
  writeLock(lock);
  console.log(`\nWrote ${OUTPUTS.length} files to ${outDir} and ${generatedDir}, and updated the lock.`);
}

function check() {
  const lock = readLock();
  const entries = Object.entries(lock);
  if (entries.length === 0) {
    console.error('brand-icons.lock.json is empty. Run the generator.');
    process.exit(1);
  }
  const problems = [];
  for (const [key, expected] of entries) {
    const [brand, file] = key.split('/');
    for (const root of [
      path.join(PACKAGE_ROOT, 'assets', brand, 'generated'),
      path.join(DEFAULT_OUT, brand),
    ]) {
      const candidate = path.join(root, file);
      if (!existsSync(candidate)) {
        problems.push(`${candidate} is missing`);
        continue;
      }
      const data = readFileSync(candidate);
      const digest = sha256(data);
      if (digest !== expected.sha256) {
        problems.push(`${candidate} sha256 ${digest}, lock says ${expected.sha256}`);
        continue;
      }
      const { width, height } = dimensions(file, data);
      if (width !== expected.width || height !== expected.height) {
        problems.push(
          `${candidate} is ${width}x${height}, lock says ${expected.width}x${expected.height}`,
        );
      }
    }
  }
  if (problems.length > 0) {
    console.error('\nBrand icons do not match brand-icons.lock.json:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nRun `npm run icons` in packages/redlabel and commit the outputs.\n');
    process.exit(1);
  }
  console.log(`Brand icons match the lock: ${entries.length} files, sha256 and dimensions.`);
}

function copy(args) {
  const brand = args.copy;
  const from = path.join(PACKAGE_ROOT, 'assets', brand, 'generated');
  if (!existsSync(from)) {
    console.error(`${from} does not exist. This package ships no generated set for "${brand}".`);
    process.exit(1);
  }
  const to = path.join(args.out, brand);
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`Copied ${brand} icons to ${to}.`);
}

const args = parseArgs(process.argv.slice(2));
if (args.check) check();
else if (args.copy) copy(args);
else await generate(args);
