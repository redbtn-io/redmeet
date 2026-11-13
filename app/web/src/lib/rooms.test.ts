/**
 * Room fields, lifecycle, and mint gate tests (Epic 1).
 *
 * Integration tests against a real MongoDB (TEST_MONGODB_URI, skips
 * without it, same convention as the Epic 0 suites; this suite uses
 * its own database name so the suites cannot drop each other's
 * data). LiveKit is pointed at a dead local port: room pre-create
 * must fail soft, and token minting is local JWT signing, verified
 * by decoding with the real livekit-server-sdk.
 *
 * The seeded host has NO connected calendar, so bookings land in
 * pending_calendar and no gateway call is ever made.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URI = process.env.TEST_MONGODB_URI;

function ownDbUri(uri: string): string {
  const [base = '', query] = uri.split('?');
  const trimmed = base.replace(/\/[^/]*$/, '');
  return `${trimmed}/redmeet-rooms-test${query ? `?${query}` : ''}`;
}

describe.skipIf(!TEST_URI)('booking rooms (Epic 1)', () => {
  let mongoose: typeof import('mongoose').default;
  let bookings: typeof import('@/lib/bookings');
  let rooms: typeof import('@/lib/rooms');
  let livekit: typeof import('@/lib/livekit');
  let MeetHost: typeof import('@/models/meet-host').MeetHost;
  let MeetType: typeof import('@/models/meet-type').MeetType;
  let MeetBooking: typeof import('@/models/meet-booking').MeetBooking;

  let host: import('mongoose').HydratedDocument<import('@/models/meet-host').MeetHostDoc>;
  let type: import('mongoose').HydratedDocument<import('@/models/meet-type').MeetTypeDoc>;

  const TEST_LIVEKIT = {
    url: 'http://127.0.0.1:9',
    apiKey: 'test-key',
    apiSecret: 'test-secret-that-is-long-enough',
  };

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
    bookings = await import('@/lib/bookings');
    rooms = await import('@/lib/rooms');
    livekit = await import('@/lib/livekit');
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    host = await MeetHost.create({
      ownerId: 'room-test-owner',
      ownerEmail: 'host@example.com',
      slug: 'roomhost',
      displayName: 'Room Host',
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
  }, 30000);

  afterAll(async () => {
    await mongoose?.disconnect();
  });

  async function bookSlot(name: string, daysOut: number) {
    const day = new Date(Date.now() + daysOut * 24 * 60 * 60 * 1000);
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    const date = day.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const { slots } = await bookings.availabilityFor(host, type, date);
    expect(slots.length).toBeGreaterThan(0);
    return bookings.createBooking(host, type, {
      date,
      time: slots[0]!.label,
      name,
      email: `${name.toLowerCase().replace(/\s/g, '.')}@example.com`,
      phone: '',
      comments: '',
    });
  }

  async function directBooking(
    startOffsetMs: number,
    lengthMs: number,
    status: import('@/models/meet-booking').BookingStatus = 'confirmed',
  ) {
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
      status,
      calendarAttempts: 0,
    });
    await rooms.ensureBookingRoom(booking, type);
    return booking;
  }

  it('stamps room fields on a new booking, created at booking time', async () => {
    const booking = await bookSlot('Field Guest', 4);
    expect(booking.roomId).toBe(`redmeet-${String(booking._id)}`);
    expect(booking.roomUrl).toContain(`/join/${String(booking._id)}`);
    expect(booking.guestJoinToken).toBeTruthy();
    expect(booking.hostJoinToken).toBeTruthy();
    expect(booking.guestJoinToken).not.toBe(booking.hostJoinToken);
    // The tokens are never the booking id itself.
    expect(booking.guestJoinToken).not.toBe(String(booking._id));
    expect(booking.roomStatus).toBe('not_created');
    expect(booking.roomProvider).toBe('livekit');
    expect(type.roomProvider).toBe('livekit');
    expect(booking.roomCreatedAt).toBeInstanceOf(Date);
    // Expiry is end + 15 minutes exactly.
    expect(booking.roomExpiresAt!.getTime() - booking.end.getTime()).toBe(15 * 60 * 1000);
  });

  it('gives two bookings different rooms and different join tokens', async () => {
    const a = await bookSlot('Guest A', 5);
    const b = await bookSlot('Guest B', 6);
    expect(a.roomId).not.toBe(b.roomId);
    expect(a.guestJoinToken).not.toBe(b.guestJoinToken);
    expect(a.hostJoinToken).not.toBe(b.hostJoinToken);
  });

  it('mints host and guest tokens inside the window, same room, own grants', async () => {
    const booking = await directBooking(-10 * 60 * 1000, 60 * 60 * 1000);
    const guestMint = await rooms.mintRoomTokenForBooking(booking, 'guest', {
      displayName: 'Direct Guest',
    });
    expect(guestMint.room).toBe(booking.roomId);
    expect(guestMint.identity).toBe(`guest-${String(booking._id)}`);
    const guestClaims = await livekit.verifyRoomToken(TEST_LIVEKIT, guestMint.token);
    expect(guestClaims.video?.room).toBe(booking.roomId);
    expect(new Set(guestClaims.video?.canPublishSources)).toEqual(
      new Set(['camera', 'microphone', 'screen_share']),
    );
    // Minting inside the window flips the room live.
    expect(booking.roomStatus).toBe('live');

    const hostMint = await rooms.mintRoomTokenForBooking(booking, 'host', {
      displayName: 'Room Host',
    });
    expect(hostMint.room).toBe(booking.roomId);
    expect(hostMint.identity).toBe(`host-${String(host._id)}`);
    const hostClaims = await livekit.verifyRoomToken(TEST_LIVEKIT, hostMint.token);
    expect(hostClaims.video?.room).toBe(booking.roomId);
    expect(hostClaims.name).toBe('Room Host');
  });

  it('caps token TTL at the room close plus a short grace', async () => {
    // Started 20 minutes ago, 30 minute meeting: closes in 25 minutes.
    const booking = await directBooking(-20 * 60 * 1000, 30 * 60 * 1000);
    const minted = await rooms.mintRoomTokenForBooking(booking, 'guest', {
      displayName: 'Direct Guest',
    });
    const claims = await livekit.verifyRoomToken(TEST_LIVEKIT, minted.token);
    const ttl = claims.exp! - claims.nbf!;
    // 25 minutes to close + 30 minutes grace, well under the 1 hour cap.
    expect(ttl).toBeGreaterThan(40 * 60);
    expect(ttl).toBeLessThanOrEqual(55 * 60 + 5);
  });

  it('refuses to mint before the room opens', async () => {
    const booking = await directBooking(60 * 60 * 1000, 30 * 60 * 1000);
    await expect(
      rooms.mintRoomTokenForBooking(booking, 'guest', { displayName: 'Direct Guest' }),
    ).rejects.toMatchObject({ code: 'room_not_open' });
  });

  it('refuses to mint after the room closes', async () => {
    const booking = await directBooking(-2 * 60 * 60 * 1000, 30 * 60 * 1000);
    await expect(
      rooms.mintRoomTokenForBooking(booking, 'guest', { displayName: 'Direct Guest' }),
    ).rejects.toMatchObject({ code: 'room_closed' });
  });

  it('refuses to mint for a cancelled booking', async () => {
    const booking = await directBooking(-10 * 60 * 1000, 60 * 60 * 1000, 'cancelled');
    await expect(
      rooms.mintRoomTokenForBooking(booking, 'guest', { displayName: 'Direct Guest' }),
    ).rejects.toMatchObject({ code: 'booking_cancelled' });
  });

  it('extends the room once by 30 minutes, and only once', async () => {
    const booking = await directBooking(-10 * 60 * 1000, 30 * 60 * 1000);
    const before = booking.roomExpiresAt!.getTime();
    const next = await rooms.extendBookingRoom(booking);
    expect(next.getTime() - before).toBe(30 * 60 * 1000);
    expect(booking.roomExtended).toBe(true);
    await expect(rooms.extendBookingRoom(booking)).rejects.toMatchObject({
      code: 'already_extended',
    });
    // And the extension is persisted, not just in memory.
    const fresh = await MeetBooking.findById(booking._id);
    expect(fresh!.roomExpiresAt!.getTime()).toBe(next.getTime());
    expect(fresh!.roomExtended).toBe(true);
  });
});
