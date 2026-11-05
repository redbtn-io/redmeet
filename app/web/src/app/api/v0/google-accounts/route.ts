import { NextResponse } from 'next/server';

import { gate } from '@/lib/api-gate';
import { listGoogleAccounts } from '@/lib/calendar';
import { logger } from '@/lib/log';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v0/google-accounts, the Google accounts the app can act
 * through, for the settings connection picker. In v1 these are the
 * accounts linked to the app PAT owner's redbtn account.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const gated = await gate(request);
  if (!gated.ok) return gated.response;
  try {
    const accounts = await listGoogleAccounts();
    return NextResponse.json({ accounts });
  } catch (error) {
    logger.warn('google accounts list failed', { error: String(error) });
    return NextResponse.json({ accounts: [], error: 'Calendar connection unavailable' });
  }
}
