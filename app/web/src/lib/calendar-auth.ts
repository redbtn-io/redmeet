import 'server-only';

import { listCalendars, listGoogleAccounts } from '@/lib/calendar';
import { getConfig } from '@/lib/config';
import type { GatewayAuth } from '@/lib/gateway';
import { logger } from '@/lib/log';
import { whoami } from '@/lib/redbtn';
import { credentialAad, openSecret, sealSecret, sealingConfigured } from '@/lib/secrets';
import {
  MeetHost,
  type CalendarSelectionEntryDoc,
  type CalendarWriteTargetDoc,
  type MeetHostDoc,
} from '@/models/meet-host';

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
    host.googleConnectionIds = accounts.map((a) => a.connectionId);
    host.calendarConnectedAt = new Date();
    await MeetHost.updateOne(
      { _id: host._id },
      {
        $set: {
          gatewayCredential: host.gatewayCredential,
          googleConnectionId: host.googleConnectionId ?? null,
          googleConnectionEmail: host.googleConnectionEmail ?? null,
          googleConnectionIds: host.googleConnectionIds,
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
 * The host's own gateway credential, opened, or null when the host has
 * no connected calendar. Connection selection is per call from here:
 * callers name the connection for each call, they do not inherit one.
 */
export async function resolveHostCalendarToken(host: MeetHostDoc): Promise<string | null> {
  if (!host.gatewayCredential) {
    const migrated = await migratePlatformCredential(host);
    if (!migrated) return null;
  }
  try {
    return openSecret(host.gatewayCredential!, credentialAad(String(host._id)));
  } catch (error) {
    logger.error('host credential could not be opened', {
      hostId: String(host._id),
      error: String(error),
    });
    return null;
  }
}

/**
 * The gateway auth for a host's calendar calls, or null when the host
 * has no connected calendar. Carries the host's legacy default
 * connection; multi-connection callers use resolveHostCalendarToken
 * plus per-connection auths instead.
 */
export async function resolveHostCalendarAuth(host: MeetHostDoc): Promise<GatewayAuth | null> {
  const token = await resolveHostCalendarToken(host);
  if (!token) return null;
  return { token, connectionId: host.googleConnectionId ?? null };
}

export interface HostCalendarSelection {
  token: string;
  selection: CalendarSelectionEntryDoc[];
  writeTarget: CalendarWriteTargetDoc;
}

/**
 * Convert the legacy single-connection fields into a selection, in
 * place and persisted. Only runs when the host has a credential and a
 * legacy connection but no selection yet, so it is a one-time forward
 * migration, not a per-request cost. The legacy calendar ids are
 * resolved against that connection's live calendar list so entries
 * carry real ids and summaries; an id that no longer resolves is
 * dropped rather than carried as a phantom blocker.
 */
async function migrateLegacySelection(
  host: MeetHostDoc,
  token: string,
): Promise<HostCalendarSelection | null> {
  const connectionId = host.googleConnectionId;
  if (!connectionId) return null;
  try {
    const [accounts, calendars] = await Promise.all([
      listGoogleAccounts(token),
      listCalendars({ token, connectionId }),
    ]);
    const email = accounts.find((a) => a.connectionId === connectionId)?.email ?? host.googleConnectionEmail ?? '';
    const byId = new Map(calendars.map((c) => [c.id, c]));
    const wanted = host.calendarIds?.length ? host.calendarIds : ['primary'];
    const selection: CalendarSelectionEntryDoc[] = [];
    for (const id of wanted) {
      const cal = id === 'primary' ? calendars.find((c) => c.primary) : byId.get(id);
      if (cal) selection.push({ connectionId, calendarId: cal.id, email, summary: cal.summary });
    }
    if (!selection.length) {
      const primary = calendars.find((c) => c.primary) ?? calendars[0];
      if (!primary) return null;
      selection.push({ connectionId, calendarId: primary.id, email, summary: primary.summary });
    }
    const writeTarget: CalendarWriteTargetDoc = {
      connectionId: selection[0]!.connectionId,
      calendarId: selection[0]!.calendarId,
    };
    host.calendarSelection = selection;
    host.calendarWriteTarget = writeTarget;
    host.calendarIds = [...new Set(selection.map((e) => e.calendarId))];
    if (!host.googleConnectionIds?.length) {
      host.googleConnectionIds = accounts.map((a) => a.connectionId);
    }
    await MeetHost.updateOne(
      { _id: host._id },
      {
        $set: {
          calendarSelection: selection,
          calendarWriteTarget: writeTarget,
          calendarIds: host.calendarIds,
          googleConnectionIds: host.googleConnectionIds,
        },
      },
    );
    logger.info('legacy calendar selection migrated', {
      hostId: String(host._id),
      calendars: selection.length,
    });
    return { token, selection, writeTarget };
  } catch (error) {
    logger.warn('legacy calendar selection migration failed', {
      hostId: String(host._id),
      error: String(error),
    });
    return null;
  }
}

/**
 * The host's calendar selection resolved for use: their credential,
 * the ticked (connection, calendar) pairs availability merges across,
 * and the pair booking events write to. Null when the host has no
 * connected calendar. A host whose record predates selections gets
 * the legacy conversion on first resolve.
 */
export async function resolveHostCalendarSelection(
  host: MeetHostDoc,
): Promise<HostCalendarSelection | null> {
  const token = await resolveHostCalendarToken(host);
  if (!token) return null;

  const selection = host.calendarSelection ?? [];
  if (selection.length) {
    let writeTarget = host.calendarWriteTarget ?? null;
    if (
      !writeTarget ||
      !selection.some(
        (e) => e.connectionId === writeTarget!.connectionId && e.calendarId === writeTarget!.calendarId,
      )
    ) {
      writeTarget = {
        connectionId: selection[0]!.connectionId,
        calendarId: selection[0]!.calendarId,
      };
      host.calendarWriteTarget = writeTarget;
      await MeetHost.updateOne(
        { _id: host._id },
        { $set: { calendarWriteTarget: writeTarget } },
      );
    }
    return { token, selection, writeTarget };
  }
  return migrateLegacySelection(host, token);
}

/** Whether the host currently has a connected calendar. */
export function hostCalendarConnected(host: MeetHostDoc): boolean {
  return typeof host.gatewayCredential === 'string' && host.gatewayCredential.length > 0;
}
