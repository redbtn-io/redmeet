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
   * Platform PAT (rpat) for the gateway. In v1 this is George's PAT, so
   * calendar operations act on his linked Google accounts (host #1).
   * Never logged.
   */
  mcpPat: string | null;
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
    };
  }
  return cached;
}

/** Test seam. */
export function resetConfig(): void {
  cached = null;
}
