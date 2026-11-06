import 'server-only';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/log';

/**
 * The redbtn hub's whoami: GET /api/auth/me accepts a PAT bearer and
 * answers with the token owner's identity. redMeet uses it for exactly
 * two ownership proofs, and nothing else:
 *
 *   1. Connect flow: a pasted token is only stored when its owner IS
 *      the signed-in host. Nobody can wire someone else's calendar
 *      into their booking page by pasting a token they found.
 *   2. Platform migration: the legacy app PAT (REDMEET_MCP_PAT) is only
 *      sealed into the host record whose ownerId matches the PAT's
 *      owner.
 *
 * The token itself is never logged or stored by this module.
 */
export interface RedbtnIdentity {
  userId: string;
  email: string;
}

export async function whoami(token: string): Promise<RedbtnIdentity | null> {
  const config = getConfig();
  try {
    const res = await fetch(`${config.redbtnApiUrl}/api/auth/me`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        // Same browser UA the gateway client sends; edges refuse bots.
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { id?: string; email?: string } };
    if (!data.user?.id || !data.user?.email) return null;
    return { userId: data.user.id, email: data.user.email };
  } catch (error) {
    logger.warn('whoami probe failed', { error: String(error) });
    return null;
  }
}
