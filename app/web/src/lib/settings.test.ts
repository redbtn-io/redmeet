/**
 * Meeting settings and operations integration tests (Epic 5).
 *
 * Against a real MongoDB (TEST_MONGODB_URI, skips without it,
 * own database name like the other suites) and a FAKE LiveKit
 * server: a small HTTP stub that speaks just enough Twirp for
 * the room service calls the mint and moderation make, with a
 * participant list the test controls. That makes the full
 * room behavior (story 5.1.3) testable end to end at the mint
 * and at the guest route, with no fleet server and no
 * credentials in the suite.
 *
 * Covered here, per the Epic 5 settings amendment:
 *   - a booking from a type with limit 3 fills at 3
 *   - a type with different window numbers opens and closes
 *     on its own numbers
 *   - unset fields fall back to the defaults
 *   - extensions follow the booking's own count and minutes
 *   - a minted token value never appears in log output
 *   - the join-events endpoint validates and logs reports
 *   - moderation against a dead media server answers clean
 *     codes (the route level half lives in moderation.test.ts)
 */
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const TEST_URI = process.env.TEST_MONGODB_URI;

function ownDbUri(uri: string): string {
  const [base = '', query] = uri.split('?');
  const trimmed = base.replace(/\/[^/]*$/, '');
  return `${trimmed}/redmeet-settings-test${query ? `?${query}` : ''}`;
}

/** Participant identities per room name, controlled by the tests. */
const fakeParticipants = new Map<string, string[]>();

function fakeParticipant(identity: string) {
  return {
    sid: `PA_${identity}`,
    identity,
    state: 2,
    tracks: [],
    metadata: '',
    joinedAt: '1700000000',
    kind: 0,
    version: 0,
    name: identity,
    attributes: {},
  };
}

async function startFakeLiveKit(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      const send = (obj: unknown) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        body = {};
      }
      const url = req.url ?? '';
      if (url.endsWith('/CreateRoom')) {
        send({
          sid: 'RM_fake',
          name: body.name ?? '',
          emptyTimeout: 0,
          maxParticipants: body.maxParticipants ?? 0,
          creationTime: '0',
          turnPassword: '',
          enabledCodecs: [],
          metadata: '',
          numParticipants: 0,
          numPublishers: 0,
          activeRecording: false,
        });
        return;
      }
      if (url.endsWith('/ListParticipants')) {
        const room = String(body.room ?? '');
        send({ participants: (fakeParticipants.get(room) ?? []).map(fakeParticipant) });
        return;
      }
      if (url.endsWith('/DeleteRoom')) {
        send({});
        return;
      }
      if (url.endsWith('/RemoveParticipant')) {
        send({});
        return;
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'not_found', msg: 'unknown method' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

describe.skipIf(!TEST_URI)('meeting settings and ops (Epic 5)', () => {
  let mongoose: typeof import('mongoose').default;
  let bookings: typeof import('@/lib/bookings');
  let rooms: typeof import('@/lib/rooms');
  let moderation: typeof import('@/lib/moderation');
  let resetConfig: typeof import('@/lib/config').resetConfig;
  let guestTokenGET: typeof import('@/app/api/public/bookings/[id]/room-token/route').GET;
  let joinEventsPOST: typeof import('@/app/api/public/bookings/[id]/join-events/route').POST;
  let MeetHost: typeof import('@/models/meet-host').MeetHost;
  let MeetType: typeof import('@/models/meet-type').MeetType;
  let MeetBooking: typeof import('@/models/meet-booking').MeetBooking;

  type HostDoc = import('mongoose').HydratedDocument<import('@/models/meet-host').MeetHostDoc>;
  type TypeDoc = import('mongoose').HydratedDocument<import('@/models/meet-type').MeetTypeDoc>;
  type BookingDoc = import('mongoose').HydratedDocument<
    import('@/models/meet-booking').MeetBookingDoc
  >;

  let host: HostDoc;
  let defaultType: TypeDoc;
  let smallType: TypeDoc;
  let fake: { server: Server; url: string };

  beforeAll(async () => {
    fake = await startFakeLiveKit();
    process.env.MONGODB_URI = ownDbUri(TEST_URI!);
    process.env.AUTH_MONGODB_URI = ownDbUri(TEST_URI!).replace(
      'redmeet-settings-test',
      'redmeet-settings-auth-test',
    );
    process.env.JWT_SECRET = 'settings-test-secret';
    process.env.LIVEKIT_URL = fake.url;
    process.env.LIVEKIT_API_KEY = 'APIsettingsTestKey';
    process.env.LIVEKIT_API_SECRET = 'settings-test-secret-that-is-long-enough';
    mongoose = (await import('mongoose')).default;
    await mongoose.connect(process.env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    ({ resetConfig } = await import('@/lib/config'));
    resetConfig();
    bookings = await import('@/lib/bookings');
    rooms = await import('@/lib/rooms');
    moderation = await import('@/lib/moderation');
    ({ GET: guestTokenGET } = await import('@/app/api/public/bookings/[id]/room-token/route'));
    ({ POST: joinEventsPOST } = await import(
      '@/app/api/public/bookings/[id]/join-events/route'
    ));
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    host = await MeetHost.create({
      ownerId: 'settings-test-owner',
      ownerEmail: 'host@example.com',
      slug: 'settingshost',
      displayName: 'Settings Host',
      timeZone: 'America/New_York',
    });
    defaultType = await MeetType.create({
      hostId: host._id,
      slug: 'plain',
      name: 'Plain call',
      lengthMinutes: 30,
      active: true,
      sort: 0,
    });
    smallType = await MeetType.create({
      hostId: host._id,
      slug: 'small',
      name: 'Small call',
      lengthMinutes: 30,
      active: true,
      sort: 1,
      participantLimit: 3,
      openLeadMinutes: 20,
      closeLagMinutes: 45,
      extensionMinutes: 10,
      extensionsAllowed: 2,
    });
  }, 30000);

  afterAll(async () => {
    fake?.server.close();
    await mongoose?.disconnect();
  });

  async function bookSlot(type: TypeDoc, name: string, daysOut: number) {
    const day = new Date(Date.now() + daysOut * 24 * 60 * 60 * 1000);
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    const date = day.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const { slots } = await bookings.availabilityFor(host, type, date);
    expect(slots.length).toBeGreaterThan(0);
    return bookings.createBooking(host, type, {
      date,
      time: slots[0]!.label,
      name,
      email: 'guest@example.com',
      phone: '',
      comments: '',
    });
  }

  async function directBooking(
    type: TypeDoc,
    startOffsetMs: number,
    lengthMs = 30 * 60 * 1000,
  ): Promise<BookingDoc> {
    const start = new Date(Date.now() + startOffsetMs);
    const booking = await MeetBooking.create({
      hostId: host._id,
      meetTypeId: type._id,
      guestName: 'Direct Guest',
      guestEmail: 'direct@example.com',
      guestPhone: '',
      comments: '',
      start,
      end: new Date(start.getTime() + lengthMs),
      status: 'pending_calendar',
      calendarAttempts: 0,
    });
    await rooms.ensureBookingRoom(booking, type);
    return booking;
  }

  it('a booking made from a type with custom settings carries them', async () => {
    const booking = await bookSlot(smallType, 'Custom Guest', 3);
    expect(booking.participantLimit).toBe(3);
    expect(booking.openLeadMinutes).toBe(20);
    expect(booking.closeLagMinutes).toBe(45);
    expect(booking.extensionMinutes).toBe(10);
    expect(booking.extensionsAllowed).toBe(2);
    expect(rooms.roomOpensAt(booking).getTime()).toBe(booking.start.getTime() - 20 * 60 * 1000);
    expect(booking.roomExpiresAt?.getTime()).toBe(booking.end.getTime() + 45 * 60 * 1000);
  });

  it('a booking from a type with nothing set falls back to the defaults', async () => {
    const booking = await bookSlot(defaultType, 'Default Guest', 4);
    expect(booking.participantLimit).toBe(10);
    expect(booking.openLeadMinutes).toBe(5);
    expect(booking.closeLagMinutes).toBe(15);
    expect(booking.extensionMinutes).toBe(30);
    expect(booking.extensionsAllowed).toBe(1);
    expect(rooms.roomOpensAt(booking).getTime()).toBe(booking.start.getTime() - 5 * 60 * 1000);
    expect(booking.roomExpiresAt?.getTime()).toBe(booking.end.getTime() + 15 * 60 * 1000);
  });

  it('a type with different window numbers opens and closes on its own numbers', async () => {
    const now = new Date();
    // Starts in 10 minutes: inside the small type's 20 minute
    // lead, outside the default 5.
    const soonSmall = await directBooking(smallType, 10 * 60 * 1000);
    expect(rooms.roomPhase(soonSmall, now)).toBe('open');
    const soonDefault = await directBooking(defaultType, 10 * 60 * 1000);
    expect(rooms.roomPhase(soonDefault, now)).toBe('not_open');
    // Ended 30 minutes ago: inside the small type's 45 minute
    // lag, outside the default 15, at the mint too.
    const endedSmall = await directBooking(smallType, -60 * 60 * 1000);
    expect(rooms.roomPhase(endedSmall, now)).toBe('open');
    const minted = await rooms.mintRoomTokenForBooking(endedSmall, 'guest', {
      displayName: 'Direct Guest',
    });
    expect(minted.token).toBeTruthy();
    const endedDefault = await directBooking(defaultType, -60 * 60 * 1000);
    expect(rooms.roomPhase(endedDefault, now)).toBe('closed');
    await expect(
      rooms.mintRoomTokenForBooking(endedDefault, 'guest', { displayName: 'Direct Guest' }),
    ).rejects.toMatchObject({ code: 'room_closed' });
  });

  it('a limit 3 room fills at 3 and the next seat is refused at the mint and the route', async () => {
    const booking = await directBooking(smallType, -60 * 1000);
    const room = booking.roomId!;
    const hostIdentity = rooms.hostIdentityFor(String(host._id));
    const guestIdentity = rooms.guestIdentityFor(String(booking._id));
    try {
      // Three seats taken, none of them the guest's: the
      // guest is the joiner past the limit.
      fakeParticipants.set(room, [hostIdentity, 'extra-1', 'extra-2']);
      await expect(
        rooms.mintRoomTokenForBooking(booking, 'guest', { displayName: 'Direct Guest' }),
      ).rejects.toMatchObject({ code: 'room_full', limit: 3 });

      const res = await guestTokenGET(
        new Request(`http://test.local/x?t=${booking.guestJoinToken}`),
        { params: Promise.resolve({ id: String(booking._id) }) },
      );
      expect(res.status).toBe(409);
      expect(((await res.json()) as { code?: string }).code).toBe('room_full');

      // The host is refused too when the seats are held by
      // others: the limit counts people, not roles.
      fakeParticipants.set(room, [guestIdentity, 'extra-1', 'extra-2']);
      await expect(
        rooms.mintRoomTokenForBooking(booking, 'host', { displayName: 'Settings Host' }),
      ).rejects.toMatchObject({ code: 'room_full' });

      // A participant already holding one of the 3 seats
      // rejoins: the seat is theirs, the room is not full
      // for them.
      fakeParticipants.set(room, [guestIdentity, 'extra-1', 'extra-2']);
      const rejoined = await rooms.mintRoomTokenForBooking(booking, 'guest', {
        displayName: 'Direct Guest',
      });
      expect(rejoined.token).toBeTruthy();

      // Two seats taken, neither of them the guest's: the
      // third seat is still open to a new identity.
      fakeParticipants.set(room, [hostIdentity, 'extra-1']);
      const third = await rooms.mintRoomTokenForBooking(booking, 'guest', {
        displayName: 'Direct Guest',
      });
      expect(third.token).toBeTruthy();
    } finally {
      fakeParticipants.delete(room);
    }
  });

  it('extensions follow the booking count and minutes', async () => {
    const small = await directBooking(smallType, -60 * 1000);
    const first = await rooms.extendBookingRoom(small);
    expect(first.getTime()).toBe(small.end.getTime() + 45 * 60 * 1000 + 10 * 60 * 1000);
    const second = await rooms.extendBookingRoom(small);
    expect(second.getTime()).toBe(small.end.getTime() + 45 * 60 * 1000 + 20 * 60 * 1000);
    await expect(rooms.extendBookingRoom(small)).rejects.toMatchObject({
      code: 'already_extended',
    });

    const plain = await directBooking(defaultType, -60 * 1000);
    const once = await rooms.extendBookingRoom(plain);
    expect(once.getTime()).toBe(plain.end.getTime() + 15 * 60 * 1000 + 30 * 60 * 1000);
    await expect(rooms.extendBookingRoom(plain)).rejects.toMatchObject({
      code: 'already_extended',
    });
  });

  it('a minted token value never appears in the log output', async () => {
    const booking = await directBooking(defaultType, -60 * 1000);
    const lines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    let mintedToken = '';
    try {
      const minted = await rooms.mintRoomTokenForBooking(booking, 'guest', {
        displayName: 'Direct Guest',
      });
      mintedToken = minted.token;
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
    expect(mintedToken.length).toBeGreaterThan(20);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(mintedToken);
      expect(line).not.toContain(booking.guestJoinToken!);
      expect(line).not.toContain(booking.hostJoinToken!);
    }
    const mintLine = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((parsed) => parsed.event === 'token_minted');
    expect(mintLine).toBeTruthy();
    expect(mintLine?.bookingId).toBe(String(booking._id));
    expect(mintLine?.room).toBe(booking.roomId);
    expect(mintLine?.role).toBe('guest');
  });

  it('the join-events endpoint validates and logs client reports', async () => {
    const booking = await directBooking(defaultType, -60 * 1000);
    const call = (body: unknown) =>
      joinEventsPOST(
        new Request('http://test.local/x', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: String(booking._id) }) },
      );

    const lines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    try {
      const blocked = await call({
        t: booking.guestJoinToken,
        kind: 'failure',
        failureType: 'browser_blocked',
      });
      expect(blocked.status).toBe(204);

      const joined = await call({ t: booking.guestJoinToken, kind: 'joined' });
      expect(joined.status).toBe(204);

      const invented = await call({
        t: booking.guestJoinToken,
        kind: 'failure',
        failureType: 'exploded',
      });
      expect(invented.status).toBe(400);

      const stranger = await call({ t: 'not-the-token', kind: 'joined' });
      expect(stranger.status).toBe(403);
    } finally {
      logSpy.mockRestore();
    }
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(
      parsed.some((p) => p.event === 'join_failed' && p.type === 'browser_blocked'),
    ).toBe(true);
    expect(parsed.some((p) => p.event === 'participant_joined')).toBe(true);
    expect(JSON.stringify(parsed)).not.toContain(booking.guestJoinToken!);
  });

  it('moderation against a dead media server answers clean codes, never a raw throw', async () => {
    const booking = await directBooking(defaultType, -60 * 1000);
    process.env.LIVEKIT_URL = 'http://127.0.0.1:9';
    resetConfig();
    try {
      // mute_all was the Epic 4 rough edge: its participant
      // list call was unwrapped and a dead server meant a
      // raw failure. Now it answers the unreachable code.
      await expect(moderation.muteAllGuests(booking)).rejects.toMatchObject({
        code: 'livekit_unreachable',
      });
      // The single mute keeps its 409 family answer.
      await expect(
        moderation.muteParticipantMic(booking, rooms.guestIdentityFor(String(booking._id))),
      ).rejects.toMatchObject({ code: 'participant_not_found' });
      // Remove and end never needed the server to answer:
      // the record and the close stand.
      await moderation.removeParticipantFromRoom(
        booking,
        rooms.guestIdentityFor(String(booking._id)),
      );
      const fresh = await MeetBooking.findById(booking._id);
      expect(fresh?.removedIdentities).toContain(rooms.guestIdentityFor(String(booking._id)));
    } finally {
      process.env.LIVEKIT_URL = fake.url;
      resetConfig();
    }
  });
});
