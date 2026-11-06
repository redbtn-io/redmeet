import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';

import { lightenColor } from '@redmeet/core';

import { getHostBySlug, listMeetingTypes } from '@/lib/hosts';

export const dynamic = 'force-dynamic';

/**
 * The public booking page, the original's pages/booking in the modern
 * house styling: dark flat surfaces, hairline borders, the host's
 * colour as the only accent. "Meet with <name>" and a grid of meeting
 * types that lead into the booking flow. Public: the proxy exempts
 * this shape and guests have no account.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ user: string }>;
}): Promise<Metadata> {
  const { user } = await params;
  const host = await getHostBySlug(user);
  if (!host) return { title: 'redMeet' };
  return { title: `Meet with ${host.displayName}, redMeet` };
}

export default async function BookingPage({
  params,
}: {
  params: Promise<{ user: string }>;
}) {
  const { user } = await params;
  const host = await getHostBySlug(user);
  if (!host) notFound();
  const types = await listMeetingTypes(host._id, true);

  const style = {
    '--primary-color': host.color,
    '--highlight-color': lightenColor(host.color, 20),
  } as CSSProperties;

  return (
    <div className="min-h-screen bg-bg text-text-primary" style={style}>
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-4">
          <span className="flex items-center gap-2">
            <img src="/icons/redbtn-logo.png" alt="" className="h-7 w-7 rounded-md" />
            <span className="text-sm font-medium">redMeet</span>
          </span>
          <p className="text-xs uppercase tracking-wider text-text-secondary">{host.timeZone}</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="flex flex-col items-center text-center">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold text-white"
            style={{ backgroundColor: 'var(--primary-color)' }}
          >
            {host.displayName.charAt(0).toUpperCase()}
          </div>
          <h1 className="mt-4 text-2xl font-semibold">Meet with {host.displayName}</h1>
          <p className="mt-2 max-w-md text-sm text-text-secondary">
            {host.bio || 'Pick a meeting type and a time that works for you.'}
          </p>
        </div>

        <div className="mt-10">
          {types.length === 0 ? (
            <p className="text-center text-sm text-text-secondary">
              No meeting types are open right now. Check back soon.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {types.map((meeting) => (
                <Link
                  key={String(meeting._id)}
                  href={`/${host.slug}/${meeting.slug}`}
                  className="group rounded-2xl border border-border bg-bg-secondary p-5 transition hover:border-[var(--primary-color)]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-medium">{meeting.name}</h2>
                    <span
                      aria-hidden
                      className="text-text-secondary transition group-hover:text-text-primary"
                    >
                      →
                    </span>
                  </div>
                  {meeting.description && (
                    <p className="mt-1.5 line-clamp-2 text-sm text-text-secondary">
                      {meeting.description}
                    </p>
                  )}
                  <p className="mt-3 text-xs uppercase tracking-wider text-text-secondary">
                    {meeting.lengthMinutes} minutes
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <p className="mt-12 text-center text-sm text-text-secondary">
          Powered by{' '}
          <a
            href="https://redbtn.io"
            target="_blank"
            rel="noreferrer"
            className="font-medium underline-offset-4 hover:underline"
            style={{ color: 'var(--primary-color)' }}
          >
            redbtn
          </a>
        </p>
      </main>
    </div>
  );
}
