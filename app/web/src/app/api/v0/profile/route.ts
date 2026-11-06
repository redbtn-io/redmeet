import { NextResponse } from 'next/server';

import { isValidSlug, profilePatchSchema } from '@redmeet/core';

import { badRequest, gate } from '@/lib/api-gate';
import { getDb } from '@/lib/db';
import { ensureHost, hostPrivateJson } from '@/lib/hosts';
import { MeetHost } from '@/models/meet-host';

export const dynamic = 'force-dynamic';

/** GET /api/v0/profile, the caller's host profile. */
export async function GET(request: Request): Promise<NextResponse> {
  const gated = await gate(request);
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);
  return NextResponse.json({ host: hostPrivateJson(host) });
}

/** PATCH /api/v0/profile, update slug, name, bio, colour, calendars. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const gated = await gate(request, { mutate: true });
  if (!gated.ok) return gated.response;
  const host = await ensureHost(gated.user);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Request body must be JSON');
  }
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? 'Invalid profile update');
  }
  const patch = parsed.data;

  if (patch.slug !== undefined) {
    if (!isValidSlug(patch.slug)) {
      return badRequest('That slug is not available. Use lowercase letters, numbers and dashes, and avoid app words like app or api.');
    }
    if (patch.slug !== host.slug) {
      await getDb();
      const taken = await MeetHost.exists({ slug: patch.slug, _id: { $ne: host._id } });
      if (taken) return badRequest('That slug is already taken');
    }
  }

  Object.assign(host, {
    ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
    ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
    ...(patch.bio !== undefined ? { bio: patch.bio } : {}),
    ...(patch.color !== undefined ? { color: patch.color } : {}),
    ...(patch.calendarIds !== undefined ? { calendarIds: patch.calendarIds } : {}),
    // googleConnectionId is not patchable here on purpose: it only
    // changes through /api/v0/calendar/connect, which proves ownership.
  });
  await host.save();
  return NextResponse.json({ host: hostPrivateJson(host) });
}
