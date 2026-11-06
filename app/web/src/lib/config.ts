/**
 * Runtime configuration, read once and validated WHERE IT IS USED.
 *
 * Nothing here reads a secret at build time. RedRun's appConfig.env is a RUNTIME
 * environment; a value read during `next build` is either baked into an image
 * layer or absent, and both are wrong for a key that acts on a user's calendar.
 */
import 'server-only';

export interface Config {
  baseUrl: string;
  accountsUrl: string;
  cookieName: string;
  cookieDomain: string;
  jwtSecret: string | null;
  mongoUri: string | null;
  authMongoUri: string | null;
  /** MCP gateway the calendar client talks to redbtn connections through. */
  mcpGatewayUrl: string;
  /**
   * Platform PAT (rpat) for the gateway. This is the MIGRATION SOURCE
   * only: whichever host owns this PAT gets it sealed into their own
   * host record (see lib/hosts.ts), after which every calendar call
   * runs under a per-host credential and this value is never used as a
   * caller identity again. Never logged.
   */
  mcpPat: string | null;
  /**
   * Keyring for sealing per-host credentials at rest, current key first:
   * REDMEET_ENCRYPTION_KEY, then REDMEET_ENCRYPTION_KEY_PREVIOUS. Same
   * shape as accounts' SSO_ENCRYPTION_KEY (64 hex chars). Never logged.
   */
  encryptionKeys: Array<string | null>;
  /** The redbtn hub API, for the PAT whoami probe (/api/auth/me). */
  redbtnApiUrl: string;
}

let cached: Config | null = null;

function envOrNull(name: string): string | null {
  const v = process.env[name]?.trim();
  return v ? v : null;
}

/** Validated at first use, never at module load. */
export function getConfig(): Config {
  if (!cached) {
    cached = {
      baseUrl: process.env.BASE_URL ?? '',
      accountsUrl: process.env.ACCOUNTS_URL ?? 'https://accounts.redbtn.io',
      cookieName: process.env.COOKIE_NAME ?? 'red_session',
      cookieDomain: process.env.COOKIE_DOMAIN ?? '.redbtn.io',
      jwtSecret: process.env.JWT_SECRET ?? null,
      mongoUri: process.env.MONGODB_URI ?? null,
      authMongoUri: process.env.AUTH_MONGODB_URI ?? null,
      mcpGatewayUrl: (process.env.MCP_GATEWAY_URL ?? 'https://mcp.redbtn.io').replace(/\/+$/, ''),
      mcpPat: envOrNull('REDMEET_MCP_PAT'),
      encryptionKeys: [envOrNull('REDMEET_ENCRYPTION_KEY'), envOrNull('REDMEET_ENCRYPTION_KEY_PREVIOUS')],
      redbtnApiUrl: (process.env.REDBTN_API_URL ?? 'https://app.redbtn.io').replace(/\/+$/, ''),
    };
  }
  return cached;
}

/** Test seam. */
export function resetConfig(): void {
  cached = null;
}
