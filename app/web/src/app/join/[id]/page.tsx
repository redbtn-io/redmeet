import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { CSSProperties } from 'react';

import { lightenColor } from '@redmeet/core';

import { JoinLobby } from '@/components/join/JoinLobby';
import { ThemeToggle } from '@/components/ThemeToggle';
import { getDb } from '@/lib/db';
import { roomClosesAt, roomOpensAt, roomPhase } from '@/lib/rooms';
import { resolveSession, secretEquals } from '@/lib/session';
import { MeetBooking } from '@/models/meet-booking';
import { MeetHost } from '@/models/meet-host';
import { MeetType } from '@/models/meet-type';

export const dynamic = 'force-dynamic';

/**
 * The meeting join page (Epic 2), /join/<booking id>.
 *
 * Two ways in, one page:
 *
 *   - The GUEST arrives with their join link, ?t=<guest join
 *     token>. The token is checked here, in constant time,
 *     against the booking, and a bad one gets a plain refusal.
 *     Nothing about the room is reachable without it.
 *   - The HOST arrives from their dashboard with ?as=host. Host
 *     mode is NOT granted by the parameter: it is granted when
 *     the signed-in session owns this booking's host record.
 *     Anyone else who types ?as=host just gets the guest path,
 *     which still wants the token. (The mint endpoint behind
 *     host mode is session gated and owner scoped besides.)
 *
 * The lobby itself (preview, devices, the connect, and the
 * minimal in room shell) is the JoinLobby client component.
 * Where the room is in its lifecycle is computed here for first
 * paint: a cancelled or closed meeting is a plain message, not
 * a lobby that fails at the Join button.
 */

export const metadata: Metadata = { title: 'Join your meeting, redMeet' };

const OBJECT_ID_RE = /^[a-fA-F0-9]{24}$/;

function Shell({
  color,
  children,
}: {
  color: string;
  children: React.ReactNode;
}) {
  const style = {
    '--primary-color': color,
    '--highlight-color': lightenColor(color, 20),
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
      <main className="mx-auto w-full max-w-3xl px-6 pt-10">{children}</main>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-border bg-bg-secondary p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-text-secondary">{body}</p>
    </div>
  );
}

export default async function JoinPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ t?: string; as?: string }>;
}) {
  const { id } = await params;
  const { t, as } = await searchParams;
  if (!OBJECT_ID_RE.test(id)) notFound();
  await getDb();
  const booking = await MeetBooking.findById(id);
  if (!booking) notFound();
  const host = await MeetHost.findById(booking.hostId);
  const type = await MeetType.findById(booking.meetTypeId);
  if (!host || !type) notFound();

  // Host mode: the session, not the query string, decides.
  let hostMode = false;
  if (as === 'host') {
    try {
      const session = await resolveSession(
        new Request('https://meet.redbtn.io', { headers: await headers() }),
      );
      if (session.ok) {
        const ownHost = await MeetHost.findOne({ ownerId: session.user.userId });
        hostMode = Boolean(ownHost && String(ownHost._id) === String(booking.hostId));
      }
    } catch {
      hostMode = false;
    }
  }

  if (!hostMode) {
    if (!t || !booking.guestJoinToken || !secretEquals(booking.guestJoinToken, t)) {
      return (
        <Shell color={host.color}>
          <Message
            title="That join link is not valid"
            body="This link does not match this meeting's invite. Use the exact link from your calendar invite or your booking confirmation page. If you copied it by hand, check nothing was cut off."
          />
        </Shell>
      );
    }
  }

  const phase = roomPhase(booking, new Date());
  if (phase === 'cancelled') {
    return (
      <Shell color={host.color}>
        <Message
          title="This meeting was cancelled"
          body={`${type.name} with ${host.displayName} was cancelled, so there is no room to join. If that is a surprise, reply to your calendar invite and ask the host.`}
        />
      </Shell>
    );
  }
  if (phase === 'closed') {
    return (
      <Shell color={host.color}>
        <Message
          title="This meeting has ended"
          body="The room for this meeting has closed. If you still need to talk, book a new time from the host's page."
        />
      </Shell>
    );
  }

  const tz = host.timeZone;
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(booking.start);
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  const timeLabel = `${timeFmt.format(booking.start)} to ${timeFmt.format(booking.end)}`;

  return (
    <Shell color={host.color}>
      <JoinLobby
        bookingId={String(booking._id)}
        mode={hostMode ? 'host' : 'guest'}
        guestToken={hostMode ? null : (t ?? null)}
        meetingName={type.name}
        hostName={host.displayName}
        initialName={hostMode ? host.displayName : booking.guestName}
        dateLabel={dateLabel}
        timeLabel={timeLabel}
        opensAt={roomOpensAt(booking).toISOString()}
        closesAt={roomClosesAt(booking).toISOString()}
      />
    </Shell>
  );
}
