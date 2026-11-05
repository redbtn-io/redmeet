import 'server-only';
import type { HydratedDocument } from 'mongoose';

import { isValidSlug, slugify } from '@redmeet/core';

import { getDb } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { MeetHost, type MeetHostDoc } from '@/models/meet-host';
import { MeetType, type MeetTypeDoc } from '@/models/meet-type';

/**
 * Host profile lifecycle. A profile is created lazily on first sign-in
 * so the dashboard never dead-ends on an empty state: slug from the
 * email local part (uniquified), one starter meeting type, the same
 * shape the 2025 app assumed existed.
 */

export async function ensureHost(user: SessionUser): Promise<HydratedDocument<MeetHostDoc>> {
  await getDb();
  const existing = await MeetHost.findOne({ ownerId: user.userId });
  if (existing) return existing;

  const base = slugify(user.email) || 'host';
  let slug = isValidSlug(base) ? base : `${base}-meet`;
  for (let n = 2; await MeetHost.exists({ slug }); n += 1) {
    slug = `${base}-${n}`;
  }
  const displayName = user.email
    .split('@')[0]!
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const host = await MeetHost.create({
    ownerId: user.userId,
    ownerEmail: user.email,
    slug,
    displayName,
    bio: '',
    color: '#dc2626',
    timeZone: 'America/New_York',
    calendarIds: ['primary'],
    googleConnectionId: null,
  });
  await MeetType.create({
    hostId: host._id,
    slug: 'intro',
    name: 'Intro call',
    description: 'A first conversation.',
    lengthMinutes: 30,
    active: true,
    sort: 0,
  });
  return host;
}

export async function getHostBySlug(slug: string): Promise<MeetHostDoc | null> {
  await getDb();
  return MeetHost.findOne({ slug });
}

export async function listMeetingTypes(hostId: MeetHostDoc['_id'], activeOnly = false): Promise<MeetTypeDoc[]> {
  await getDb();
  return MeetType.find(activeOnly ? { hostId, active: true } : { hostId }).sort({ sort: 1, createdAt: 1 });
}

/* ---------------- serializers ---------------- */

export function hostPrivateJson(host: MeetHostDoc) {
  return {
    slug: host.slug,
    displayName: host.displayName,
    bio: host.bio,
    color: host.color,
    timeZone: host.timeZone,
    calendarIds: host.calendarIds,
    googleConnectionId: host.googleConnectionId ?? null,
    bookingUrl: `https://meet.redbtn.io/${host.slug}`,
  };
}

export function meetingTypeJson(type: MeetTypeDoc) {
  return {
    id: String(type._id),
    slug: type.slug,
    name: type.name,
    description: type.description,
    lengthMinutes: type.lengthMinutes,
    active: type.active,
  };
}

/** What a guest may see: the original's userDetails shape, renamed honestly. */
export function hostPublicJson(host: MeetHostDoc, types: MeetTypeDoc[]) {
  return {
    slug: host.slug,
    name: host.displayName,
    bio: host.bio,
    color: host.color,
    timeZone: host.timeZone,
    meetings: types.map((t) => ({
      id: String(t._id),
      link: t.slug,
      name: t.name,
      description: t.description,
      length: t.lengthMinutes,
    })),
  };
}
