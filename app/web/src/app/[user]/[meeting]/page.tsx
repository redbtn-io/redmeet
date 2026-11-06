import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { lightenColor } from '@redmeet/core';

import BookingFlow from '@/components/booking/BookingFlow';
import { getDb } from '@/lib/db';
import { getHostBySlug } from '@/lib/hosts';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * The booking flow page, the original's pages/calendar: date picker,
 * time picker, guest form, result. Public. An unknown meeting link
 * bounces back to the host's booking page, as the original did.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ user: string; meeting: string }>;
}): Promise<Metadata> {
  const { user, meeting } = await params;
  const host = await getHostBySlug(user);
  if (!host) return { title: 'redMeet' };
  return { title: `Meet with ${host.displayName}, ${meeting}, redMeet` };
}

export default async function SchedulerPage({
  params,
}: {
  params: Promise<{ user: string; meeting: string }>;
}) {
  const { user, meeting } = await params;
  const host = await getHostBySlug(user);
  if (!host) notFound();
  await getDb();
  const type = await MeetType.findOne({ hostId: host._id, slug: meeting, active: true });
  if (!type) redirect(`/${host.slug}`);

  const style = {
    '--primary-color': host.color,
    '--highlight-color': lightenColor(host.color, 20),
  } as CSSProperties;

  return (
    <div className="min-h-screen bg-bg pb-10 text-text-primary" style={style}>
      <BookingFlow
        slug={host.slug}
        hostName={host.displayName}
        meeting={{
          link: type.slug,
          name: type.name,
          description: type.description,
          length: type.lengthMinutes,
        }}
      />
    </div>
  );
}
