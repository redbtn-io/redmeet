import 'server-only';

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

import { getConfig } from '@/lib/config';

/**
 * Sealing per-host secrets (today: a host's own redbtn gateway PAT).
 *
 * This mirrors the ecosystem's existing pattern, @redbtn/redauth's SSO
 * secret sealing (dist/sso/secrets.js), so redMeet blobs look and behave
 * like every other sealed secret in the estate:
 *
 *   AES-256-GCM, fresh 96-bit IV, the context string as additional
 *   authenticated data. The AAD binds a blob to its owner: a blob sealed
 *   for one host cannot be opened for another, so a database write alone
 *   cannot move a credential between hosts.
 *
 *   Format: `v1.<keyId>.<iv>.<ct>.<tag>`, each part base64url, keyId the
 *   first 8 hex of sha256(key). The first configured key encrypts, all
 *   decrypt, so rotation needs no flag day.
 *
 * Keys come from app env: REDMEET_ENCRYPTION_KEY (64 hex chars, the
 * same shape as accounts' SSO_ENCRYPTION_KEY) and optionally
 * REDMEET_ENCRYPTION_KEY_PREVIOUS. Values are read at first use via
 * config and never logged.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

function sha256Hex(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 32 bytes as hex or base64. Anything else throws, like redauth's parser. */
function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }
  if (/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(trimmed)) {
    const decoded = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (decoded.length === KEY_BYTES) return decoded;
  }
  throw new Error('REDMEET_ENCRYPTION_KEY must be 32 bytes, as hex or base64');
}

interface Keyring {
  seal(plaintext: string, aad: string): string;
  open(sealed: string, aad: string): string;
}

let keyring: Keyring | null = null;

function getKeyring(): Keyring {
  if (keyring) return keyring;
  const rawKeys = getConfig().encryptionKeys;
  const keys: Array<{ id: string; key: Buffer }> = [];
  for (const raw of rawKeys) {
    if (!raw || !raw.trim()) continue;
    const key = parseEncryptionKey(raw);
    const id = sha256Hex(key).slice(0, 8);
    if (!keys.some((k) => k.id === id)) keys.push({ id, key });
  }
  if (keys.length === 0) {
    throw new Error('REDMEET_ENCRYPTION_KEY is not configured');
  }
  keyring = {
    seal(plaintext: string, aad: string): string {
      const current = keys[0]!;
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', current.key, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(aad, 'utf8'));
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();
      return ['v1', current.id, iv.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.');
    },
    open(sealed: string, aad: string): string {
      // One refusal for every failure mode, as in redauth: which part was
      // wrong is of no use to a caller and of some use to someone probing.
      const refuse = () => new Error('Sealed secret is unavailable');
      const parts = typeof sealed === 'string' ? sealed.split('.') : [];
      if (parts.length !== 5 || parts[0] !== 'v1') throw refuse();
      const [, keyId, ivB64, ctB64, tagB64] = parts as [string, string, string, string, string];
      const entry = keys.find((k) => k.id === keyId);
      if (!entry) throw refuse();
      const iv = Buffer.from(ivB64, 'base64url');
      const tag = Buffer.from(tagB64, 'base64url');
      if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw refuse();
      try {
        const decipher = createDecipheriv('aes-256-gcm', entry.key, iv, { authTagLength: TAG_BYTES });
        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
      } catch {
        throw refuse();
      }
    },
  };
  return keyring;
}

/** True when an encryption key is configured (the connect flow needs one). */
export function sealingConfigured(): boolean {
  return getConfig().encryptionKeys.some((k) => !!k && !!k.trim());
}

/** Seal a host secret. `aad` binds the blob to its context (the host id). */
export function sealSecret(plaintext: string, aad: string): string {
  return getKeyring().seal(plaintext, aad);
}

/** Open a sealed host secret. Throws a single opaque error on any failure. */
export function openSecret(sealed: string, aad: string): string {
  return getKeyring().open(sealed, aad);
}

/** The AAD context for a host's gateway credential. */
export function credentialAad(hostId: string): string {
  return `redmeet:gateway-credential:${hostId}`;
}
