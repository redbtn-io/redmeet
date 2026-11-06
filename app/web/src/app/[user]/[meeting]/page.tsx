import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';

import { lightenColor } from '@redmeet/core';

import BookingFlow from '@/components/booking/BookingFlow';
import { ThemeToggle } from '@/components/ThemeToggle';
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
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 transition hover:opacity-80">
            <img src="/icons/redbtn-logo.png" alt="" className="h-7 w-7 rounded-md" />
            <span className="text-sm font-medium">redMeet</span>
          </Link>
          <div className="flex items-center gap-1">
            <p className="text-xs uppercase tracking-wider text-text-secondary">{host.timeZone}</p>
            <ThemeToggle />
          </div>
        </div>
      </header>
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
