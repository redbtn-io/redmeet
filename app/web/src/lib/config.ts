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
  /**
   * LiveKit (Epic 1), the fleet's self-hosted server. The same three
   * vars, with the same meaning, as the Hub's voice rooms use on the
   * redbtn-app workspace; redMeet holds the same `redbtn-app` key
   * pair. `livekitUrl` is the PUBLIC endpoint: it is handed to
   * browsers in token responses and used server side for the room
   * service API. All three are null until configured, and the room
   * features fail closed (503) in that state, never minting against
   * a guessed endpoint. Never logged.
   */
  livekitUrl: string | null;
  livekitApiKey: string | null;
  livekitApiSecret: string | null;
  /**
   * Recording storage (Epic 6): the fleet's S3 pattern, the same
   * env names Become and the hub distribution use against the
   * fleet MinIO. Egress uploads the finished MP4 straight into
   * this bucket with these credentials carried in the egress
   * request, and the playback route reads it back with the same
   * pair. `s3Bucket` defaults to redMeet's own bucket name; the
   * endpoint and credentials are null until provisioned, and
   * recording fails closed (a plain "recording is not set up"
   * answer) in that state, never against a guessed endpoint.
   * Never logged.
   */
  s3Endpoint: string | null;
  s3Bucket: string;
  s3AccessKeyId: string | null;
  s3SecretAccessKey: string | null;
  s3Region: string;
  s3ForcePathStyle: boolean;
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
      livekitUrl: envOrNull('LIVEKIT_URL')?.replace(/\/+$/, '') ?? null,
      livekitApiKey: envOrNull('LIVEKIT_API_KEY'),
      livekitApiSecret: envOrNull('LIVEKIT_API_SECRET'),
      s3Endpoint: envOrNull('S3_ENDPOINT')?.replace(/\/+$/, '') ?? null,
      s3Bucket: envOrNull('S3_BUCKET') ?? 'redmeet-recordings',
      s3AccessKeyId: envOrNull('S3_ACCESS_KEY_ID'),
      s3SecretAccessKey: envOrNull('S3_SECRET_ACCESS_KEY'),
      s3Region: envOrNull('S3_REGION') ?? 'us-east-1',
      s3ForcePathStyle: (envOrNull('S3_FORCE_PATH_STYLE') ?? 'true') === 'true',
    };
  }
  return cached;
}

/** Test seam. */
export function resetConfig(): void {
  cached = null;
}

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * The LiveKit config, or null when any of the three vars is missing.
 * One place decides "are rooms configured", so the token endpoints,
 * the room service, and the health check all agree.
 */
export function getLiveKitConfig(): LiveKitConfig | null {
  const { livekitUrl, livekitApiKey, livekitApiSecret } = getConfig();
  if (!livekitUrl || !livekitApiKey || !livekitApiSecret) return null;
  return { url: livekitUrl, apiKey: livekitApiKey, apiSecret: livekitApiSecret };
}

export interface RecordingStorageConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  forcePathStyle: boolean;
}

/**
 * The recording storage config, or null when any piece is
 * missing. One place decides "is recording storage set up", so
 * the record endpoint, the egress request builder, the
 * playback route, and the health check all agree, exactly the
 * way getLiveKitConfig does for rooms.
 */
export function getRecordingStorageConfig(): RecordingStorageConfig | null {
  const c = getConfig();
  if (!c.s3Endpoint || !c.s3AccessKeyId || !c.s3SecretAccessKey) return null;
  return {
    endpoint: c.s3Endpoint,
    bucket: c.s3Bucket,
    accessKeyId: c.s3AccessKeyId,
    secretAccessKey: c.s3SecretAccessKey,
    region: c.s3Region,
    forcePathStyle: c.s3ForcePathStyle,
  };
}
