import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';

import { lightenColor } from '@redmeet/core';

import { ThemeToggle } from '@/components/ThemeToggle';
import { getDb } from '@/lib/db';
import { MeetBooking } from '@/models/meet-booking';
import { MeetHost } from '@/models/meet-host';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * The booking confirmation page (Epic 0), /booked/<booking id>.
 *
 * Before this page existed, a guest who booked got a modal and
 * nothing else: no URL they could return to, no record of what they
 * booked. This page is that record. It reports the booking's TRUE
 * status, the same honesty rule as the booking response: confirmed
 * only when the calendar write landed, and a held slot with a
 * pending invite says exactly that.
 */

export const metadata: Metadata = { title: 'Your booking, redMeet' };

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

export default async function BookedPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!OBJECT_ID_RE.test(id)) notFound();
  await getDb();
  const booking = await MeetBooking.findById(id);
  if (!booking) notFound();
  const host = await MeetHost.findById(booking.hostId);
  const type = await MeetType.findById(booking.meetTypeId);
  if (!host || !type) notFound();

  const tz = host.timeZone;
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(booking.start);
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const timeLabel = `${timeFmt.format(booking.start)} to ${timeFmt.format(booking.end)}`;

  const heading =
    booking.status === 'confirmed'
      ? "You're booked"
      : booking.status === 'cancelled'
        ? 'This booking was cancelled'
        : 'Your booking is in';

  const calendarLine =
    booking.status === 'confirmed'
      ? 'A calendar invite was sent to your email by Google Calendar.'
      : booking.status === 'cancelled'
        ? 'This slot has been released. If you were invited, a cancellation notice follows from Google Calendar.'
        : booking.status === 'pending_calendar'
          ? 'Your slot is held. The calendar invite has not gone out yet, because the host calendar is not connected. Your host can see this booking in redMeet.'
          : 'Your slot is held. The calendar invite hit a snag on our side, and we are retrying it. When it lands, it will come from Google Calendar.';

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
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 pt-10">
        <div className="rounded-2xl border border-border bg-bg-secondary p-8">
          <h1 className="text-2xl font-semibold">{heading}</h1>
          <p className="mt-2 text-sm text-text-secondary">{calendarLine}</p>

          <dl className="mt-6 space-y-3 text-sm">
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-text-secondary">Meeting</dt>
              <dd className="font-medium">{type.name}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-text-secondary">With</dt>
              <dd className="font-medium">{host.displayName}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-text-secondary">Date</dt>
              <dd className="font-medium">{dateLabel}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-text-secondary">Time</dt>
              <dd className="font-medium">{timeLabel}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-text-secondary">Guest</dt>
              <dd className="font-medium">{booking.guestName}</dd>
            </div>
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-text-secondary">Length</dt>
              <dd className="font-medium">{type.lengthMinutes} minutes</dd>
            </div>
          </dl>

          {booking.status !== 'cancelled' && (
            <div className="mt-6 rounded-xl border border-border p-4 text-sm text-text-secondary">
              Your meeting link will appear here once the room opens.
            </div>
          )}

          <div className="mt-8">
            <Link
              href={`/${host.slug}`}
              className="text-sm text-text-secondary underline underline-offset-4 hover:text-text-primary"
            >
              Back to {host.displayName}&rsquo;s booking page
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
