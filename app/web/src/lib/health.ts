import 'server-only';

import mongoose from 'mongoose';

import { getConfig, getLiveKitConfig, getRecordingStorageConfig } from '@/lib/config';
import { getDb } from '@/lib/db';
import { mintRoomToken, verifyRoomToken } from '@/lib/livekit';
import { checkRecordingBucket } from '@/lib/recording-storage';

/**
 * Real dependency checks for /api/health (Epic 0). The old endpoint
 * returned a static ok and checked nothing, so a wedged container
 * with a dead database still reported healthy. These checks are the
 * smallest honest set: Mongo (the app's own state) and the MCP
 * gateway (every calendar read and write goes through it). Epic 1
 * adds LiveKit: meetings are the product now, so a dead media
 * server is a red health check, not a silent surprise at join time
 * (spec story 5.1.1, pulled forward because the token service
 * lands in Epic 1). Epic 5 closes the remainder of 5.1.1: the
 * LiveKit check proved the server answers and the config exists,
 * but nothing proved the configured key pair actually works, so a
 * wrong secret stayed green until the first real join failed. The
 * token check below mints a throwaway token with the configured
 * pair and verifies it locally, which is exactly the operation
 * the token endpoints depend on. The token is never sent
 * anywhere and never logged.
 */

export interface HealthCheckResult {
  ok: boolean;
  detail: string;
}

export interface HealthReport {
  ok: boolean;
  checks: {
    mongo: HealthCheckResult;
    gateway: HealthCheckResult;
    livekit: HealthCheckResult;
    token: HealthCheckResult;
    recording: HealthCheckResult;
  };
}

const CHECK_TIMEOUT_MS = 3000;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkMongo(): Promise<HealthCheckResult> {
  try {
    await withTimeout(getDb(), CHECK_TIMEOUT_MS);
    const db = mongoose.connection.db;
    if (!db) return { ok: false, detail: 'no connection' };
    await withTimeout(db.admin().ping(), CHECK_TIMEOUT_MS);
    return { ok: true, detail: 'ping ok' };
  } catch (error) {
    return { ok: false, detail: String(error).slice(0, 200) };
  }
}

export async function checkGateway(): Promise<HealthCheckResult> {
  try {
    // Any HTTP answer at all, even an error status, proves the
    // gateway is reachable and speaking HTTP. A network failure or a
    // timeout is the down case.
    const res = await fetch(getConfig().mcpGatewayUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return { ok: true, detail: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, detail: String(error).slice(0, 200) };
  }
}

export async function checkLiveKit(): Promise<HealthCheckResult> {
  const livekit = getLiveKitConfig();
  if (!livekit) return { ok: false, detail: 'not configured' };
  try {
    // The LiveKit server answers GET / with 200 "OK". Any HTTP
    // answer proves reachability. Whether the key pair works is
    // the token check's job, below.
    const res = await fetch(livekit.url, {
      method: 'GET',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return { ok: res.ok, detail: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, detail: String(error).slice(0, 200) };
  }
}

/**
 * Token endpoint readiness (Epic 5, story 5.1.1 remainder):
 * mint a throwaway token with the configured key pair and
 * verify it with the same SDK the endpoints use. Signing is
 * local crypto, so this proves the pair is well formed and
 * self consistent without a booking, a room, or a participant.
 * It does not prove the LiveKit SERVER accepts the pair (that
 * is the reachability check plus the first real join), and it
 * never logs or returns the token itself.
 */
export async function checkTokenReadiness(): Promise<HealthCheckResult> {
  const livekit = getLiveKitConfig();
  if (!livekit) return { ok: false, detail: 'not configured' };
  try {
    const minted = await withTimeout(
      mintRoomToken(livekit, {
        room: 'redmeet-healthcheck',
        identity: 'healthcheck',
        name: 'healthcheck',
        role: 'guest',
        ttlSeconds: 60,
      }),
      CHECK_TIMEOUT_MS,
    );
    await withTimeout(verifyRoomToken(livekit, minted.token), CHECK_TIMEOUT_MS);
    return { ok: true, detail: 'mint and verify ok' };
  } catch (error) {
    return { ok: false, detail: String(error).slice(0, 200) };
  }
}

/**
 * Recording storage readiness (Epic 6). Recording is an
 * optional feature riding on provisioned storage, so an
 * UNconfigured deployment is healthy with the feature off,
 * and the check only goes red when storage is configured
 * but the bucket cannot be reached or the credentials are
 * wrong: the state where a host would press Record and hit
 * a wall the health page should have named first.
 */
export async function checkRecordingStorage(): Promise<HealthCheckResult> {
  const storage = getRecordingStorageConfig();
  if (!storage) return { ok: true, detail: 'not configured, recording is off' };
  return withTimeout(checkRecordingBucket(storage), CHECK_TIMEOUT_MS).catch((error) => ({
    ok: false,
    detail: String(error).slice(0, 200),
  }));
}

export async function checkHealth(): Promise<HealthReport> {
  const [mongo, gateway, livekit, token, recording] = await Promise.all([
    checkMongo(),
    checkGateway(),
    checkLiveKit(),
    checkTokenReadiness(),
    checkRecordingStorage(),
  ]);
  return {
    ok: mongo.ok && gateway.ok && livekit.ok && token.ok && recording.ok,
    checks: { mongo, gateway, livekit, token, recording },
  };
}
