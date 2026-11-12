import 'server-only';

import mongoose from 'mongoose';

import { getConfig } from '@/lib/config';
import { getDb } from '@/lib/db';

/**
 * Real dependency checks for /api/health (Epic 0). The old endpoint
 * returned a static ok and checked nothing, so a wedged container
 * with a dead database still reported healthy. These checks are the
 * smallest honest set: Mongo (the app's own state) and the MCP
 * gateway (every calendar read and write goes through it).
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

export async function checkHealth(): Promise<HealthReport> {
  const [mongo, gateway] = await Promise.all([checkMongo(), checkGateway()]);
  return { ok: mongo.ok && gateway.ok, checks: { mongo, gateway } };
}
