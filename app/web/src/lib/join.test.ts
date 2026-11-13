/**
 * Join route tests (Epic 2, feature 2.1 server side).
 *
 * The guest's whole credential is the join token in their link.
 * These tests drive the two public route handlers the lobby
 * calls, join-info and room-token, against a real MongoDB
 * (TEST_MONGODB_URI, skips without it, own database name like
 * the other suites) with bookings placed at four points in the
 * room lifecycle: open now, not yet open, closed, and cancelled.
 * LiveKit is pointed at a dead local port: room pre-create fails
 * soft, and minting is local JWT signing, verified by decoding
 * with the real livekit-server-sdk.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URI = process.env.TEST_MONGODB_URI;

function ownDbUri(uri: string): string {
  const [base = '', query] = uri.split('?');
  const trimmed = base.replace(/\/[^/]*$/, '');
  return `${trimmed}/redmeet-join-test${query ? `?${query}` : ''}`;
}

const TEST_LIVEKIT = {
  url: 'http://127.0.0.1:9',
  apiKey: 'testkey',
  apiSecret: 'test-secret-that-is-long-enough',
};

describe.skipIf(!TEST_URI)('join routes (Epic 2)', () => {
  let mongoose: typeof import('mongoose').default;
  let rooms: typeof import('@/lib/rooms');
  let livekit: typeof import('@/lib/livekit');
  let joinInfoGET: typeof import('@/app/api/public/bookings/[id]/join-info/route').GET;
  let roomTokenGET: typeof import('@/app/api/public/bookings/[id]/room-token/route').GET;
  let MeetHost: typeof import('@/models/meet-host').MeetHost;
  let MeetType: typeof import('@/models/meet-type').MeetType;
  let MeetBooking: typeof import('@/models/meet-booking').MeetBooking;

  type BookingDoc = import('mongoose').HydratedDocument<
    import('@/models/meet-booking').MeetBookingDoc
  >;
  let host: import('mongoose').HydratedDocument<import('@/models/meet-host').MeetHostDoc>;
  let type: import('mongoose').HydratedDocument<import('@/models/meet-type').MeetTypeDoc>;
  let openBooking: BookingDoc;
  let futureBooking: BookingDoc;
  let pastBooking: BookingDoc;
  let cancelledBooking: BookingDoc;

  async function makeBooking(startOffsetMin: number, cancelled = false): Promise<BookingDoc> {
    const start = new Date(Date.now() + startOffsetMin * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const booking = await MeetBooking.create({
      hostId: host._id,
      meetTypeId: type._id,
      guestName: 'Join Guest',
      guestEmail: 'join.guest@example.com',
      guestPhone: '',
      comments: '',
      start,
      end,
      status: cancelled ? 'cancelled' : 'pending_calendar',
      calendarAttempts: 0,
    });
    await rooms.ensureBookingRoom(booking, type);
    return booking;
  }

  function call(
    handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
    id: string,
    query: string,
  ): Promise<Response> {
    return handler(new Request(`http://test.local/x?${query}`), {
      params: Promise.resolve({ id }),
    });
  }

  beforeAll(async () => {
    process.env.MONGODB_URI = ownDbUri(TEST_URI!);
    process.env.LIVEKIT_URL = TEST_LIVEKIT.url;
    process.env.LIVEKIT_API_KEY = TEST_LIVEKIT.apiKey;
    process.env.LIVEKIT_API_SECRET = TEST_LIVEKIT.apiSecret;
    mongoose = (await import('mongoose')).default;
    await mongoose.connect(process.env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    const config = await import('@/lib/config');
    config.resetConfig();
    rooms = await import('@/lib/rooms');
    livekit = await import('@/lib/livekit');
    ({ GET: joinInfoGET } = await import('@/app/api/public/bookings/[id]/join-info/route'));
    ({ GET: roomTokenGET } = await import('@/app/api/public/bookings/[id]/room-token/route'));
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    host = await MeetHost.create({
      ownerId: 'test-owner-join',
      ownerEmail: 'joinhost@example.com',
      slug: 'joinhost',
      displayName: 'Join Host',
      timeZone: 'America/New_York',
    });
    type = await MeetType.create({
      hostId: host._id,
      slug: 'intro',
      name: 'Intro call',
      lengthMinutes: 30,
      active: true,
      sort: 0,
    });

    openBooking = await makeBooking(-1);
    futureBooking = await makeBooking(120);
    pastBooking = await makeBooking(-120);
    cancelledBooking = await makeBooking(-1, true);
  }, 30000);

  afterAll(async () => {
    await mongoose?.disconnect();
  });

  it('builds the guest join link from the room URL and the guest token only', () => {
    const url = rooms.guestJoinUrlFor(openBooking);
    expect(url).toBe(`${openBooking.roomUrl}?t=${openBooking.guestJoinToken}`);
    expect(url).not.toContain(openBooking.hostJoinToken!);
    expect(rooms.guestJoinUrlFor({ roomUrl: undefined, guestJoinToken: 'x' })).toBeNull();
    expect(rooms.guestJoinUrlFor({ roomUrl: 'https://x/join/1', guestJoinToken: undefined })).toBeNull();
  });

  it('join-info answers for a good token, with the open phase inside the window', async () => {
    const res = await call(joinInfoGET, String(openBooking._id), `t=${openBooking.guestJoinToken}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.meetingName).toBe('Intro call');
    expect(body.hostName).toBe('Join Host');
    expect(body.guestName).toBe('Join Guest');
    expect(body.phase).toBe('open');
  });

  it('join-info refuses a bad token, the same 403 as the mint route', async () => {
    const res = await call(joinInfoGET, String(openBooking._id), 't=not-the-token');
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code?: string }).code).toBe('bad_token');
  });

  it('join-info reports not_open and closed and cancelled as data, not errors', async () => {
    const future = await call(
      joinInfoGET,
      String(futureBooking._id),
      `t=${futureBooking.guestJoinToken}`,
    );
    expect(future.status).toBe(200);
    const futureBody = (await future.json()) as Record<string, unknown>;
    expect(futureBody.phase).toBe('not_open');
    expect(new Date(String(futureBody.opensAt)).getTime()).toBeGreaterThan(Date.now());

    const past = await call(joinInfoGET, String(pastBooking._id), `t=${pastBooking.guestJoinToken}`);
    expect(((await past.json()) as { phase?: string }).phase).toBe('closed');

    const cancelled = await call(
      joinInfoGET,
      String(cancelledBooking._id),
      `t=${cancelledBooking.guestJoinToken}`,
    );
    expect(((await cancelled.json()) as { phase?: string }).phase).toBe('cancelled');
  });

  it('mints a guest token for a good link inside the window, with the meeting grants', async () => {
    const res = await call(
      roomTokenGET,
      String(openBooking._id),
      `t=${openBooking.guestJoinToken}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; room: string };
    expect(body.room).toBe(openBooking.roomId);
    const claims = await livekit.verifyRoomToken(TEST_LIVEKIT, body.token);
    expect(claims.sub).toBe(`guest-${String(openBooking._id)}`);
    expect(claims.name).toBe('Join Guest');
    expect(claims.video?.room).toBe(openBooking.roomId);
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    const sources = (claims.video?.canPublishSources ?? []).map((s) => String(s).toLowerCase());
    expect(sources).toContain('camera');
    expect(sources).toContain('microphone');
    expect(sources).toContain('screen_share');
  });

  it('mints under the name typed in the lobby, not the booked name', async () => {
    const res = await call(
      roomTokenGET,
      String(openBooking._id),
      `t=${openBooking.guestJoinToken}&name=${encodeURIComponent('Lobby Name')}`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    const claims = await livekit.verifyRoomToken(TEST_LIVEKIT, body.token);
    expect(claims.name).toBe('Lobby Name');
  });

  it('the mint route refuses a bad token, a closed room, and a cancelled booking', async () => {
    const bad = await call(roomTokenGET, String(openBooking._id), 't=nope');
    expect(bad.status).toBe(403);
    expect(((await bad.json()) as { code?: string }).code).toBe('bad_token');

    const closed = await call(
      roomTokenGET,
      String(pastBooking._id),
      `t=${pastBooking.guestJoinToken}`,
    );
    expect(closed.status).toBe(410);
    expect(((await closed.json()) as { code?: string }).code).toBe('room_closed');

    const cancelled = await call(
      roomTokenGET,
      String(cancelledBooking._id),
      `t=${cancelledBooking.guestJoinToken}`,
    );
    expect(cancelled.status).toBe(410);
    expect(((await cancelled.json()) as { code?: string }).code).toBe('booking_cancelled');
  });

  it('the mint route refuses before the room opens, with the window in the answer', async () => {
    const res = await call(
      roomTokenGET,
      String(futureBooking._id),
      `t=${futureBooking.guestJoinToken}`,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string; opensAt?: string };
    expect(body.code).toBe('room_not_open');
    expect(new Date(body.opensAt!).getTime()).toBeGreaterThan(Date.now());
  });
});

describe.skipIf(!TEST_URI)('host join route (Epic 2)', () => {
  let mongoose: typeof import('mongoose').default;
  let livekit: typeof import('@/lib/livekit');
  let hostTokenPOST: typeof import('@/app/api/v0/bookings/[id]/room-token/route').POST;
  let hostJwt: string;
  let otherJwt: string;
  let bookingId: string;
  let roomId: string;
  let hostId: string;

  beforeAll(async () => {
    process.env.MONGODB_URI = ownDbUri(TEST_URI!);
    process.env.AUTH_MONGODB_URI = ownDbUri(TEST_URI!).replace(
      'redmeet-join-test',
      'redmeet-join-auth-test',
    );
    process.env.JWT_SECRET = 'join-test-jwt-secret-that-is-long-enough';
    process.env.REDMEET_DEFAULT_BRAND_ID = 'redbtn';
    // Vitest defines BASE_URL as "/"; redauth resolves it as a URL.
    process.env.BASE_URL = 'https://meet.redbtn.io';
    process.env.LIVEKIT_URL = TEST_LIVEKIT.url;
    process.env.LIVEKIT_API_KEY = TEST_LIVEKIT.apiKey;
    process.env.LIVEKIT_API_SECRET = TEST_LIVEKIT.apiSecret;

    mongoose = (await import('mongoose')).default;
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    await mongoose.connection.dropDatabase();
    const config = await import('@/lib/config');
    config.resetConfig();
    const session = await import('@/lib/session');
    session.resetAuth();
    livekit = await import('@/lib/livekit');
    ({ POST: hostTokenPOST } = await import('@/app/api/v0/bookings/[id]/room-token/route'));
    const rooms = await import('@/lib/rooms');
    const { MeetHost } = await import('@/models/meet-host');
    const { MeetType } = await import('@/models/meet-type');
    const { MeetBooking } = await import('@/models/meet-booking');
    await MeetBooking.createIndexes();

    const host = await MeetHost.create({
      ownerId: 'test-owner-hostjoin',
      ownerEmail: 'hostjoin@example.com',
      slug: 'hostjoin',
      displayName: 'Joining Host',
      timeZone: 'America/New_York',
    });
    hostId = String(host._id);
    const type = await MeetType.create({
      hostId: host._id,
      slug: 'intro',
      name: 'Intro call',
      lengthMinutes: 30,
      active: true,
      sort: 0,
    });
    const start = new Date(Date.now() - 60 * 1000);
    const booking = await MeetBooking.create({
      hostId: host._id,
      meetTypeId: type._id,
      guestName: 'Host Side Guest',
      guestEmail: 'hsg@example.com',
      guestPhone: '',
      comments: '',
      start,
      end: new Date(start.getTime() + 30 * 60 * 1000),
      status: 'pending_calendar',
      calendarAttempts: 0,
    });
    await rooms.ensureBookingRoom(booking, type);
    bookingId = String(booking._id);
    roomId = booking.roomId!;

    // A real device session plus JWT, minted with redauth's own
    // primitives against the throwaway auth database: the same
    // shape accounts issues, verified by the route's own gate.
    const auth = session.getAuth();
    hostJwt = (
      await auth.createSessionWithDevice(
        { userId: 'test-owner-hostjoin', email: 'hostjoin@example.com', accountLevel: 4 },
        { userAgent: 'vitest' },
      )
    ).jwt;
    otherJwt = (
      await auth.createSessionWithDevice(
        { userId: 'test-owner-stranger', email: 'stranger@example.com', accountLevel: 4 },
        { userAgent: 'vitest' },
      )
    ).jwt;
  }, 30000);

  afterAll(async () => {
    await mongoose?.disconnect();
  });

  function post(jwt: string | null, displayName?: string): Promise<Response> {
    return hostTokenPOST(
      new Request(`http://test.local/api/v0/bookings/${bookingId}/room-token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://test.local',
          ...(jwt ? { cookie: `red_session=${jwt}` } : {}),
        },
        body: JSON.stringify(displayName ? { displayName } : {}),
      }),
      { params: Promise.resolve({ id: bookingId }) },
    );
  }

  it('mints a host token for the owner session, under the lobby name', async () => {
    const res = await post(hostJwt, 'Host Typed Name');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; room: string };
    expect(body.room).toBe(roomId);
    const claims = await livekit.verifyRoomToken(TEST_LIVEKIT, body.token);
    expect(claims.sub).toBe(`host-${hostId}`);
    expect(claims.name).toBe('Host Typed Name');
  });

  it('refuses with no session, and 404s for a different signed-in user', async () => {
    const anon = await post(null);
    expect(anon.status).toBe(401);
    const stranger = await post(otherJwt);
    expect(stranger.status).toBe(404);
  });
});
