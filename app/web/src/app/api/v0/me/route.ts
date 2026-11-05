import { NextResponse } from 'next/server';

import { ensureHost, hostPrivateJson } from '@/lib/hosts';
import { resolveSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * GET /api/v0/me, the signed-in user's profile for the shell, plus
 * their redMeet host profile (created on first sight).
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await resolveSession(request);
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }
  const host = await ensureHost(session.user);
  return NextResponse.json({
    email: session.user.email,
    accountLevel: session.user.accountLevel,
    host: hostPrivateJson(host),
  });
}
