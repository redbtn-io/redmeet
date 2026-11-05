import { NextResponse } from 'next/server';

import { meetingTypeInputSchema } from '@redmeet/core';

import { badRequest, gate } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import { ensureHost, listMeetingTypes, meetingTypeJson } from '@/lib/hosts';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/** GET /api/v0/meeting-types, the caller's meeting types. */
export async function GET(request: Request): Promise<NextResponse> {
  const gated = await gate(request);
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const types = await listMeetingTypes(host._id);
  return NextResponse.json({ meetingTypes: types.map(meetingTypeJson) });
}

/** POST /api/v0/meeting-types, create one. */
export async function POST(request: Request): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const parsed = meetingTypeInputSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? 'Invalid meeting type');
  }

  await getDb();
  const clash = await MeetType.exists({ hostId: host._id, slug: parsed.data.slug });
  if (clash) return badRequest('You already have a meeting type with that link');
  const count = await MeetType.countDocuments({ hostId: host._id });
  const created = await MeetType.create({ hostId: host._id, sort: count, ...parsed.data });
  return NextResponse.json({ meetingType: meetingTypeJson(created) }, { status: 201 });
}
