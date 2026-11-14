/**
 * Moderation route tests (Epic 4, features 4.1 to 4.3).
 *
 * Drives the real route handlers against a real MongoDB
 * (TEST_MONGODB_URI, skips without it, own database names like
 * the other suites) with a forged redauth device session for
 * the host and one for a stranger, the join.test.ts pattern.
 * LiveKit is pointed at a dead local port on purpose: room
 * pre-create fails soft, minting is local JWT signing, and the
 * moderation paths that must work without a reachable media
 * server (the removal record, the end meeting close, the
 * admission decisions) are exactly the ones exercised here.
 * The live mute and disconnect behavior against a real
 * LiveKit server is covered by the Playwright smoke pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URI = process.env.TEST_MONGODB_URI;

function ownDbUri(uri: string, name: string): string {
  const [base = '', query] = uri.split('?');
  const trimmed = base.replace(/\/[^/]*$/, '');
  return `${trimmed}/${name}${query ? `?${query}` : ''}`;
}

const TEST_LIVEKIT = {
  url: 'http://127.0.0.1:9',
  apiKey: 'testkey',
  apiSecret: 'test-secret-that-is-long-enough',
};

describe.skipIf(!TEST_URI)('moderation routes (Epic 4)', () => {
  let mongoose: typeof import('mongoose').default;
  let rooms: typeof import('@/lib/rooms');
  let bookings: typeof import('@/lib/bookings');
  let hosts: typeof import('@/lib/hosts');
  let moderatePOST: typeof import('@/app/api/v0/bookings/[id]/moderate/route').POST;
  let waitingGET: typeof import('@/app/api/v0/bookings/[id]/waiting/route').GET;
  let waitingRoomPOST: typeof import('@/app/api/public/bookings/[id]/waiting-room/route').POST;
  let joinInfoGET: typeof import('@/app/api/public/bookings/[id]/join-info/route').GET;
  let roomTokenGET: typeof import('@/app/api/public/bookings/[id]/room-token/route').GET;
  let MeetHost: typeof import('@/models/meet-host').MeetHost;
  let MeetType: typeof import('@/models/meet-type').MeetType;
  let MeetBooking: typeof import('@/models/meet-booking').MeetBooking;

  type BookingDoc = import('mongoose').HydratedDocument<
    import('@/models/meet-booking').MeetBookingDoc
  >;
  type HostDoc = import('mongoose').HydratedDocument<import('@/models/meet-host').MeetHostDoc>;
  type TypeDoc = import('mongoose').HydratedDocument<import('@/models/meet-type').MeetTypeDoc>;

  let host: HostDoc;
  let openType: TypeDoc;
  let waitingType: TypeDoc;
  let hostJwt: string;
  let otherJwt: string;

  async function makeBooking(type: TypeDoc, guestName: string): Promise<BookingDoc> {
    const start = new Date(Date.now() - 60 * 1000);
    const booking = await MeetBooking.create({
      hostId: host._id,
      meetTypeId: type._id,
      guestName,
      guestEmail: 'guest@example.com',
      guestPhone: '',
      comments: '',
      start,
      end: new Date(start.getTime() + 30 * 60 * 1000),
      status: 'pending_calendar',
      calendarAttempts: 0,
    });
    await rooms.ensureBookingRoom(booking, type);
    return booking;
  }

  function moderate(
    jwt: string | null,
    id: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return moderatePOST(
      new Request(`http://test.local/api/v0/bookings/${id}/moderate`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://test.local',
          ...(jwt ? { cookie: `red_session=${jwt}` } : {}),
        },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  function waiting(jwt: string | null, id: string): Promise<Response> {
    return waitingGET(
      new Request(`http://test.local/api/v0/bookings/${id}/waiting`, {
        headers: { ...(jwt ? { cookie: `red_session=${jwt}` } : {}) },
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  function guestCall(
    handler: (
      req: Request,
      ctx: { params: Promise<{ id: string }> },
    ) => Promise<Response>,
    id: string,
    query: string,
    init?: RequestInit,
  ): Promise<Response> {
    return handler(new Request(`http://test.local/x?${query}`, init), {
      params: Promise.resolve({ id }),
    });
  }

  function askToJoin(booking: BookingDoc, name: string): Promise<Response> {
    return guestCall(
      waitingRoomPOST,
      String(booking._id),
      `t=${booking.guestJoinToken}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      },
    );
  }

  function guestMint(booking: BookingDoc): Promise<Response> {
    return guestCall(roomTokenGET, String(booking._id), `t=${booking.guestJoinToken}`);
  }

  beforeAll(async () => {
    process.env.MONGODB_URI = ownDbUri(TEST_URI!, 'redmeet-moderation-test');
    process.env.AUTH_MONGODB_URI = ownDbUri(TEST_URI!, 'redmeet-moderation-auth-test');
    process.env.JWT_SECRET = 'moderation-test-jwt-secret-that-is-long';
    process.env.REDMEET_DEFAULT_BRAND_ID = 'redbtn';
    // Vitest defines BASE_URL as "/"; redauth resolves it as a URL.
    process.env.BASE_URL = 'https://meet.redbtn.io';
    process.env.LIVEKIT_URL = TEST_LIVEKIT.url;
    process.env.LIVEKIT_API_KEY = TEST_LIVEKIT.apiKey;
    process.env.LIVEKIT_API_SECRET = TEST_LIVEKIT.apiSecret;

    mongoose = (await import('mongoose')).default;
    await mongoose.connect(process.env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    const config = await import('@/lib/config');
    config.resetConfig();
    const session = await import('@/lib/session');
    session.resetAuth();
    rooms = await import('@/lib/rooms');
    bookings = await import('@/lib/bookings');
    hosts = await import('@/lib/hosts');
    ({ POST: moderatePOST } = await import('@/app/api/v0/bookings/[id]/moderate/route'));
    ({ GET: waitingGET } = await import('@/app/api/v0/bookings/[id]/waiting/route'));
    ({ POST: waitingRoomPOST } = await import(
      '@/app/api/public/bookings/[id]/waiting-room/route'
    ));
    ({ GET: joinInfoGET } = await import('@/app/api/public/bookings/[id]/join-info/route'));
    ({ GET: roomTokenGET } = await import('@/app/api/public/bookings/[id]/room-token/route'));
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    host = await MeetHost.create({
      ownerId: 'test-owner-moderation',
      ownerEmail: 'modhost@example.com',
      slug: 'modhost',
      displayName: 'Mod Host',
      timeZone: 'America/New_York',
    });
    openType = await MeetType.create({
      hostId: host._id,
      slug: 'open-call',
      name: 'Open call',
      lengthMinutes: 30,
      active: true,
      sort: 0,
    });
    waitingType = await MeetType.create({
      hostId: host._id,
      slug: 'waiting-call',
      name: 'Waiting call',
      lengthMinutes: 30,
      active: true,
      sort: 1,
      entryMode: 'waiting_room',
    });

    const auth = session.getAuth();
    hostJwt = (
      await auth.createSessionWithDevice(
        { userId: 'test-owner-moderation', email: 'modhost@example.com', accountLevel: 4 },
        { userAgent: 'vitest' },
      )
    ).jwt;
    otherJwt = (
      await auth.createSessionWithDevice(
        { userId: 'test-owner-stranger2', email: 'stranger2@example.com', accountLevel: 4 },
        { userAgent: 'vitest' },
      )
    ).jwt;
  }, 30000);

  afterAll(async () => {
    await mongoose?.disconnect();
  });

  it('carries the entry mode from the meeting type onto the booking', async () => {
    // The room stamp path (every booking passes through it).
    const stamped = await makeBooking(waitingType, 'Stamp Guest');
    expect(stamped.entryMode).toBe('waiting_room');
    const stampedOpen = await makeBooking(openType, 'Open Guest');
    expect(stampedOpen.entryMode).toBe('open');

    // The real booking path (createBooking's claim).
    const day = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    const date = day.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const { slots } = await bookings.availabilityFor(host, waitingType, date);
    expect(slots.length).toBeGreaterThan(0);
    const booked = await bookings.createBooking(host, waitingType, {
      date,
      time: slots[0]!.label,
      name: 'Booked Guest',
      email: 'booked@example.com',
      phone: '',
      comments: '',
    });
    expect(booked.entryMode).toBe('waiting_room');

    // The settings surface reads the same field back out.
    expect(hosts.meetingTypeJson(waitingType).entryMode).toBe('waiting_room');
    expect(hosts.meetingTypeJson(openType).entryMode).toBe('open');

    // The input schema defaults to open when the field is absent.
    const core = await import('@redmeet/core');
    const parsed = core.meetingTypeInputSchema.parse({
      slug: 'x',
      name: 'X',
      lengthMinutes: 30,
    });
    expect(parsed.entryMode).toBe('open');
  });

  it('refuses moderation with no session, and 404s for a different signed-in user', async () => {
    const booking = await makeBooking(openType, 'Gate Guest');
    const anon = await moderate(null, String(booking._id), { action: 'end' });
    expect(anon.status).toBe(401);
    const stranger = await moderate(otherJwt, String(booking._id), { action: 'end' });
    expect(stranger.status).toBe(404);
    // The refused end did nothing.
    const fresh = await MeetBooking.findById(booking._id);
    expect(fresh?.roomStatus).not.toBe('closed');

    const anonWaiting = await waiting(null, String(booking._id));
    expect(anonWaiting.status).toBe(401);
    const strangerWaiting = await waiting(otherJwt, String(booking._id));
    expect(strangerWaiting.status).toBe(404);
  });

  it('refuses to remove the host identity itself', async () => {
    const booking = await makeBooking(openType, 'Self Guest');
    const res = await moderate(hostJwt, String(booking._id), {
      action: 'remove',
      identity: `host-${String(host._id)}`,
    });
    expect(res.status).toBe(400);
    const fresh = await MeetBooking.findById(booking._id);
    expect(fresh?.removedIdentities ?? []).not.toContain(`host-${String(host._id)}`);
  });

  it('a removed guest cannot mint again, while a dropped guest still can', async () => {
    const booking = await makeBooking(openType, 'Removed Guest');
    const guestIdentity = `guest-${String(booking._id)}`;

    const before = await guestMint(booking);
    expect(before.status).toBe(200);

    const removed = await moderate(hostJwt, String(booking._id), {
      action: 'remove',
      identity: guestIdentity,
    });
    expect(removed.status).toBe(200);

    const fresh = await MeetBooking.findById(booking._id);
    expect(fresh?.removedIdentities).toContain(guestIdentity);

    const after = await guestMint(booking);
    expect(after.status).toBe(403);
    expect(((await after.json()) as { code?: string }).code).toBe('guest_removed');

    const info = await guestCall(
      joinInfoGET,
      String(booking._id),
      `t=${booking.guestJoinToken}`,
    );
    const infoBody = (await info.json()) as { removed?: boolean };
    expect(infoBody.removed).toBe(true);

    // A guest who merely dropped has no record: a fresh
    // booking's guest mints fine, which is the same code path
    // a dropped guest re-enters through.
    const dropped = await makeBooking(openType, 'Dropped Guest');
    const rejoin = await guestMint(dropped);
    expect(rejoin.status).toBe(200);
  });

  it('mute of a participant who is not in the room answers 409', async () => {
    const booking = await makeBooking(openType, 'Mute Guest');
    const res = await moderate(hostJwt, String(booking._id), {
      action: 'mute',
      identity: `guest-${String(booking._id)}`,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('participant_not_found');
  });

  it('end meeting closes the booking room and ends the token window', async () => {
    const booking = await makeBooking(openType, 'End Guest');
    const res = await moderate(hostJwt, String(booking._id), { action: 'end' });
    expect(res.status).toBe(200);

    const fresh = await MeetBooking.findById(booking._id);
    expect(fresh?.roomStatus).toBe('closed');
    expect(fresh?.roomEndedAt).toBeTruthy();

    const mint = await guestMint(booking);
    expect(mint.status).toBe(410);
    expect(((await mint.json()) as { code?: string }).code).toBe('room_closed');

    const info = await guestCall(
      joinInfoGET,
      String(booking._id),
      `t=${booking.guestJoinToken}`,
    );
    expect(((await info.json()) as { phase?: string }).phase).toBe('closed');
  });

  it('waiting room: no token before admission, deny ends the try, admit lets them in', async () => {
    const booking = await makeBooking(waitingType, 'Waiting Guest');

    // No publishing token before admission, ever.
    const early = await guestMint(booking);
    expect(early.status).toBe(403);
    expect(((await early.json()) as { code?: string }).code).toBe('admission_required');

    // The ask records the wait and still mints nothing.
    const asked = await askToJoin(booking, 'Waiting Guest');
    expect(asked.status).toBe(200);
    const stillEarly = await guestMint(booking);
    expect(stillEarly.status).toBe(403);

    // The host sees the waiting guest.
    const hostView = await waiting(hostJwt, String(booking._id));
    expect(hostView.status).toBe(200);
    const hostBody = (await hostView.json()) as {
      entryMode?: string;
      admission?: { state?: string; name?: string } | null;
    };
    expect(hostBody.entryMode).toBe('waiting_room');
    expect(hostBody.admission?.state).toBe('waiting');
    expect(hostBody.admission?.name).toBe('Waiting Guest');

    // Deny ends that attempt; the mint stays refused.
    const denied = await moderate(hostJwt, String(booking._id), { action: 'deny' });
    expect(denied.status).toBe(200);
    const afterDeny = await guestMint(booking);
    expect(afterDeny.status).toBe(403);
    const info = await guestCall(
      joinInfoGET,
      String(booking._id),
      `t=${booking.guestJoinToken}`,
    );
    expect(((await info.json()) as { admissionState?: string }).admissionState).toBe(
      'denied',
    );

    // A decision with nobody waiting is a conflict, not a no-op.
    const denyAgain = await moderate(hostJwt, String(booking._id), { action: 'deny' });
    expect(denyAgain.status).toBe(409);
    expect(((await denyAgain.json()) as { code?: string }).code).toBe('guest_not_waiting');

    // Asking again is a fresh ask; the host admits; the mint opens.
    const askedAgain = await askToJoin(booking, 'Waiting Guest');
    expect(askedAgain.status).toBe(200);
    const admitted = await moderate(hostJwt, String(booking._id), { action: 'admit' });
    expect(admitted.status).toBe(200);
    const mint = await guestMint(booking);
    expect(mint.status).toBe(200);
  });

  it('the waiting ask refuses a removed guest and an open meeting', async () => {
    const booking = await makeBooking(waitingType, 'Removed Waiting Guest');
    const removed = await moderate(hostJwt, String(booking._id), {
      action: 'remove',
      identity: `guest-${String(booking._id)}`,
    });
    expect(removed.status).toBe(200);
    const ask = await askToJoin(booking, 'Removed Waiting Guest');
    expect(ask.status).toBe(403);
    expect(((await ask.json()) as { code?: string }).code).toBe('guest_removed');

    const openBooking = await makeBooking(openType, 'Open Ask Guest');
    const openAsk = await askToJoin(openBooking, 'Open Ask Guest');
    expect(openAsk.status).toBe(409);
    expect(((await openAsk.json()) as { code?: string }).code).toBe('not_waiting_room');
  });

  it('mute_all with an unreachable media server answers 409 livekit_unreachable (Epic 5)', async () => {
    // This suite points LiveKit at a dead port on purpose.
    // Before Epic 5, mute_all was the one moderation action
    // whose participant list call was unwrapped, so this
    // exact call surfaced a raw 500. Now it answers the
    // clean code, same 409 family as the single mute.
    const booking = await makeBooking(openType, 'Mute All Guest');
    const res = await moderate(hostJwt, String(booking._id), { action: 'mute_all' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code?: string }).code).toBe('livekit_unreachable');
  });
});
