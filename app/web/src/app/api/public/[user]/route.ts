import { NextResponse } from 'next/server';

import { notFound } from '@/lib/api-gate';
import { getHostBySlug, hostPublicJson, listMeetingTypes } from '@/lib/hosts';

export const dynamic = 'force-dynamic';

/**
 * GET /api/public/:user, a host's public booking profile: name, bio,
 * brand colour, and the meeting types a guest may book. No session:
 * guests have no account, that is the point.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ user: string }> },
): Promise<NextResponse> {
  const { user } = await params;
  const host = await getHostBySlug(user);
  if (!host) return notFound('No booking page at that link');
  const types = await listMeetingTypes(host._id, true);
  return NextResponse.json(hostPublicJson(host, types));
}
