import 'server-only';

import { listGoogleAccounts } from '@/lib/calendar';
import { getConfig } from '@/lib/config';
import type { GatewayAuth } from '@/lib/gateway';
import { logger } from '@/lib/log';
import { whoami } from '@/lib/redbtn';
import { credentialAad, openSecret, sealSecret, sealingConfigured } from '@/lib/secrets';
import { MeetHost, type MeetHostDoc } from '@/models/meet-host';

/**
 * Resolving a host record to the gateway auth its calendar calls run
 * under. This is the ONLY path from a host to a credential:
 *
 *   1. The host's own sealed credential (Settings connect flow), opened
 *      with the host's AAD, plus the connection id the host picked
 *      from the list that credential returned.
 *   2. Failing that, the one-time platform migration: if the legacy
 *      app PAT (REDMEET_MCP_PAT) belongs to THIS host (proven by the
 *      whoami probe), it is sealed into the host's record and the host
 *      is on the same per-host path as everyone else from then on.
 *   3. Otherwise null: the host has no calendar. Callers degrade to
 *      the app's own bookings and label it, they never borrow another
 *      host's calendar.
 */

export class CalendarNotConnectedError extends Error {
  constructor() {
    super('Host calendar is not connected');
    this.name = 'CalendarNotConnectedError';
  }
}

const MIGRATION_RETRY_MS = 10 * 60 * 1000;
const migrationMisses = new Map<string, number>();

/**
 * The platform PAT migration. Returns true when the host now holds a
 * sealed credential. Best effort and quiet: a miss (the PAT belongs to
 * someone else, or platform pieces are unconfigured) is cached per
 * process so public booking traffic does not probe on every request.
 */
async function migratePlatformCredential(host: MeetHostDoc): Promise<boolean> {
  const hostId = String(host._id);
  const lastMiss = migrationMisses.get(hostId);
  if (lastMiss && Date.now() - lastMiss < MIGRATION_RETRY_MS) return false;

  const config = getConfig();
  const pat = config.mcpPat;
  if (!pat || !sealingConfigured()) {
    migrationMisses.set(hostId, Date.now());
    return false;
  }

  try {
    const identity = await whoami(pat);
    if (!identity || identity.userId !== host.ownerId) {
      migrationMisses.set(hostId, Date.now());
      return false;
    }
    const accounts = await listGoogleAccounts(pat);
    const chosen = accounts.find((a) => a.isDefault) ?? accounts[0];
    host.gatewayCredential = sealSecret(pat, credentialAad(hostId));
    if (chosen) {
      host.googleConnectionId = chosen.connectionId;
      host.googleConnectionEmail = chosen.email;
    }
    host.calendarConnectedAt = new Date();
    await MeetHost.updateOne(
      { _id: host._id },
      {
        $set: {
          gatewayCredential: host.gatewayCredential,
          googleConnectionId: host.googleConnectionId ?? null,
          googleConnectionEmail: host.googleConnectionEmail ?? null,
          calendarConnectedAt: host.calendarConnectedAt,
        },
      },
    );
    logger.info('platform credential migrated to host record', { hostId });
    return true;
  } catch (error) {
    migrationMisses.set(hostId, Date.now());
    logger.warn('platform credential migration failed', { hostId, error: String(error) });
    return false;
  }
}

/**
 * The gateway auth for a host's calendar calls, or null when the host
 * has no connected calendar.
 */
export async function resolveHostCalendarAuth(host: MeetHostDoc): Promise<GatewayAuth | null> {
  if (!host.gatewayCredential) {
    const migrated = await migratePlatformCredential(host);
    if (!migrated) return null;
  }
  try {
    const token = openSecret(host.gatewayCredential!, credentialAad(String(host._id)));
    return { token, connectionId: host.googleConnectionId ?? null };
  } catch (error) {
    logger.error('host credential could not be opened', {
      hostId: String(host._id),
      error: String(error),
    });
    return null;
  }
}

/** Whether the host currently has a connected calendar. */
export function hostCalendarConnected(host: MeetHostDoc): boolean {
  return typeof host.gatewayCredential === 'string' && host.gatewayCredential.length > 0;
}
