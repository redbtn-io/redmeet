import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';

import { lightenColor } from '@redmeet/core';

import { getHostBySlug, listMeetingTypes } from '@/lib/hosts';

export const dynamic = 'force-dynamic';

/**
 * The public booking page, ported from the original's pages/booking:
 * a light card dressed in the host's colour, "Meet with <name>", and a
 * grid of meeting types that lead into the booking flow. Public: the
 * proxy exempts this shape and guests have no account.
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
    <div className="min-h-screen bg-gray-100 text-gray-900" style={style}>
      <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col bg-white md:my-0 md:shadow-xl lg:my-0">
        <div
          className="p-4 text-white shadow-xl"
          style={{ backgroundColor: 'var(--primary-color)' }}
        >
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Meet with {host.displayName}</h3>
            <p className="text-xs uppercase opacity-70">Eastern Time</p>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center space-x-4 p-4 pt-10">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-full text-2xl font-semibold text-white"
            style={{ backgroundColor: 'var(--primary-color)' }}
          >
            {host.displayName.charAt(0).toUpperCase()}
          </div>
          <br />
          <div>
            <p className="text-center text-sm text-gray-600">
              {host.bio || 'Pick a meeting type and a time that works for you.'}
            </p>
          </div>
        </div>

        <div className="p-4 md:p-6">
          {types.length === 0 ? (
            <p className="text-center text-sm text-gray-500">
              No meeting types are open right now. Check back soon.
            </p>
          ) : (
            <div className="mx-auto grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
              {types.map((meeting) => (
                <Link
                  key={String(meeting._id)}
                  href={`/${host.slug}/${meeting.slug}`}
                  className="block h-36 cursor-pointer overflow-hidden border-t border-gray-300 p-4 shadow-sm hover:bg-gray-100"
                >
                  <h2 className="text-md font-semibold">{meeting.name}</h2>
                  <p className="mt-2 text-sm text-gray-600">{meeting.description}</p>
                  <p className="mt-2 text-xs uppercase text-gray-400">
                    {meeting.lengthMinutes} minutes
                  </p>
                </Link>
              ))}
            </div>
          )}
          <div className="mt-8 flex items-center justify-center text-sm text-gray-500">
            <p>
              Powered by{' '}
              <a
                href="https://redbtn.io"
                target="_blank"
                rel="noreferrer"
                className="hover:text-gray-700"
                style={{ color: 'var(--primary-color)' }}
              >
                redbtn
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
