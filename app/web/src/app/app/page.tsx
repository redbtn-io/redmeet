'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Card, IconCopy, IconExternal, PageHeader } from './ui';

interface Host {
  slug: string;
  displayName: string;
  bio: string;
  color: string;
  timeZone: string;
  bookingUrl: string;
  calendarConnected: boolean;
  googleConnectionEmail: string | null;
}

interface MeetingType {
  id: string;
  slug: string;
  name: string;
  description: string;
  lengthMinutes: number;
  active: boolean;
}

interface Booking {
  id: string;
  guestName: string;
  guestEmail: string;
  start: string;
  end: string;
  status: string;
  meetingName: string;
}

/**
 * Dashboard, the port of the original's Schedule page: your booking
 * link up top, your agenda below, booking cards in your colour. The
 * agenda lists this app's bookings (the original listed raw calendar
 * events; the bookings are the record of truth here, and each one is
 * also on the calendar).
 */
export default function Dashboard() {
  const [host, setHost] = useState<Host | null>(null);
  const [types, setTypes] = useState<MeetingType[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch('/api/v0/me').then((r) => (r.ok ? r.json() : Promise.reject(new Error('me')))),
      fetch('/api/v0/meeting-types').then((r) => (r.ok ? r.json() : { meetingTypes: [] })),
      fetch('/api/v0/bookings').then((r) => (r.ok ? r.json() : { bookings: [] })),
    ])
      .then(([me, t, b]) => {
        if (!live) return;
        setHost(me.host);
        setTypes(t.meetingTypes ?? []);
        setBookings(b.bookings ?? []);
      })
      .catch(() => live && setError('Could not load your dashboard. Try again in a moment.'));
    return () => {
      live = false;
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of bookings) {
      const day = new Date(b.start).toLocaleDateString('en-US');
      map.set(day, [...(map.get(day) ?? []), b]);
    }
    return [...map.entries()];
  }, [bookings]);

  async function copyLink() {
    if (!host) return;
    try {
      await navigator.clipboard.writeText(host.bookingUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (error) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Card>
          <p className="text-sm text-text-secondary">{error}</p>
        </Card>
      </>
    );
  }
  if (!host) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <p className="text-sm text-text-secondary">Loading...</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${host.displayName}'s Schedule`}
        sub="Share your link, and bookings land here and on your calendar."
      />

      {!host.calendarConnected && (
        <Card className="mb-6 border-accent/40">
          <p className="text-sm font-medium">Calendar not connected</p>
          <p className="mt-1 text-sm text-text-secondary">
            Guests booking through your link see times from your redMeet bookings only, not
            your real calendar, and new bookings arrive without a calendar invite.{' '}
            <Link href="/app/settings" className="text-text-primary underline underline-offset-4">
              Connect your calendar in Settings
            </Link>{' '}
            to fix that.
          </p>
        </Card>
      )}

      <Card className="mb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-text-secondary">Your booking link</p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            className="rounded-lg px-3 py-2 font-mono text-sm text-white"
            style={{ backgroundColor: host.color }}
          >
            meet.redbtn.io/{host.slug}
          </span>
          <button
            onClick={copyLink}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary"
          >
            <IconCopy /> {copied ? 'Copied' : 'Copy link'}
          </button>
          <a
            href={`/${host.slug}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm text-text-secondary transition hover:text-text-primary"
          >
            <IconExternal /> View page
          </a>
          <Link href="/app/settings" className="ml-auto text-sm text-text-secondary underline-offset-4 hover:underline">
            Edit profile and meeting types
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {types.filter((t) => t.active).map((t) => (
            <a
              key={t.id}
              href={`/${host.slug}/${t.slug}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-border px-3 py-1 text-xs text-text-secondary transition hover:text-text-primary"
            >
              {t.name}, {t.lengthMinutes} min
            </a>
          ))}
        </div>
      </Card>

      <h3 className="mb-3 text-lg font-semibold">Agenda</h3>
      {bookings.length === 0 ? (
        <Card>
          <p className="text-sm text-text-secondary">
            No bookings yet. When a guest books through your link, it shows up here.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col space-y-4">
          {grouped.map(([day, dayBookings]) => {
            const isToday = new Date(day).toDateString() === new Date().toDateString();
            const weekday = new Date(day)
              .toLocaleDateString('en-US', { weekday: 'short' })
              .toLowerCase();
            const mmd = new Date(day).toLocaleDateString([], { month: 'numeric', day: 'numeric' });
            return (
              <div className="flex space-x-3" key={day}>
                <div className="flex flex-1 flex-col items-center text-sm" style={{ fontVariant: 'small-caps' }}>
                  <span className={isToday ? 'text-accent' : 'text-text-secondary'}>
                    <span className={`text-lg ${isToday ? 'font-bold' : ''}`}>{weekday}</span>
                    <br />
                    {mmd}
                  </span>
                </div>
                <div className="flex-1 space-y-2 overflow-hidden" style={{ flexGrow: 7 }}>
                  {dayBookings.map((b) => {
                    const start = new Date(b.start);
                    const end = new Date(b.end);
                    const ended = end < new Date();
                    const ongoing = start < new Date() && !ended;
                    return (
                      <div
                        key={b.id}
                        className={`flex flex-col rounded-lg p-3 text-white ${ongoing ? 'pulse' : ''} ${ended ? 'opacity-35' : ''}`}
                        style={{ backgroundColor: ended ? '#9ca3af' : host.color }}
                      >
                        <div className="truncate text-sm font-medium">
                          {b.meetingName} with {b.guestName}
                        </div>
                        <div className="text-sm opacity-90">
                          {start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} -{' '}
                          {end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          {b.status === 'calendar_failed' && (
                            <span className="ml-2 rounded bg-black/30 px-1.5 py-0.5 text-xs">
                              calendar invite pending
                            </span>
                          )}
                          {b.status === 'pending_calendar' && (
                            <span className="ml-2 rounded bg-black/30 px-1.5 py-0.5 text-xs">
                              not on a calendar yet
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <hr className="mt-4 border-border" />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
