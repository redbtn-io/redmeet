import { NextResponse } from 'next/server';

import { meetingTypePatchSchema } from '@redmeet/core';

import { badRequest, gate, notFound } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import { ensureHost, meetingTypeJson } from '@/lib/hosts';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/** PATCH /api/v0/meeting-types/:id, owner-scoped update. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const parsed = meetingTypePatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? 'Invalid meeting type update');
  }

  await getDb();
  const type = await MeetType.findOne({ _id: id, hostId: host._id });
  if (!type) return notFound('Meeting type not found');
  if (parsed.data.slug && parsed.data.slug !== type.slug) {
    const clash = await MeetType.exists({ hostId: host._id, slug: parsed.data.slug });
    if (clash) return badRequest('You already have a meeting type with that link');
  }
  Object.assign(type, parsed.data);
  await type.save();
  return NextResponse.json({ meetingType: meetingTypeJson(type) });
}

/** DELETE /api/v0/meeting-types/:id, owner-scoped delete. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  const { id } = await params;
  await getDb();
  const deleted = await MeetType.findOneAndDelete({ _id: id, hostId: host._id });
  if (!deleted) return notFound('Meeting type not found');
  return NextResponse.json({ ok: true });
}
