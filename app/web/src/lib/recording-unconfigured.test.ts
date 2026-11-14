/**
 * Recording with storage unconfigured (Epic 6).
 *
 * The deployment shape on day one: LiveKit is set up, the
 * S3 variables are not (the bucket and its scoped user are a
 * MinIO admin step). Recording must fail CLOSED and in plain
 * words in that state, and health must stay green with the
 * feature honestly off, the checkRecordingStorage contract.
 * Own file so the module registry has no S3 env at all.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URI = process.env.TEST_MONGODB_URI;

function ownDbUri(uri: string, name: string): string {
  const [base = '', query] = uri.split('?');
  const trimmed = base.replace(/\/[^/]*$/, '');
  return `${trimmed}/${name}${query ? `?${query}` : ''}`;
}

describe.skipIf(!TEST_URI)('recording unconfigured (Epic 6)', () => {
  let mongoose: typeof import('mongoose').default;
  let rooms: typeof import('@/lib/rooms');
  let recording: typeof import('@/lib/recording');
  let health: typeof import('@/lib/health');
  let recordPOST: typeof import('@/app/api/v0/bookings/[id]/record/route').POST;
  let MeetHost: typeof import('@/models/meet-host').MeetHost;
  let MeetType: typeof import('@/models/meet-type').MeetType;
  let MeetBooking: typeof import('@/models/meet-booking').MeetBooking;

  let hostJwt: string;
  let bookingId: string;

  beforeAll(async () => {
    process.env.MONGODB_URI = ownDbUri(TEST_URI!, 'redmeet-recording-unconf-test');
    process.env.AUTH_MONGODB_URI = ownDbUri(TEST_URI!, 'redmeet-recording-unconf-auth');
    process.env.JWT_SECRET = 'recording-unconf-jwt-secret-that-is-long';
    process.env.REDMEET_DEFAULT_BRAND_ID = 'redbtn';
    process.env.BASE_URL = 'https://meet.redbtn.io';
    // LiveKit points at a dead port: pre-create fails soft,
    // and recording never gets that far without storage.
    process.env.LIVEKIT_URL = 'http://127.0.0.1:9';
    process.env.LIVEKIT_API_KEY = 'APIrecordingUnconfKey';
    process.env.LIVEKIT_API_SECRET = 'recording-unconf-secret-that-is-long';
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;

    mongoose = (await import('mongoose')).default;
    await mongoose.connect(process.env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    const config = await import('@/lib/config');
    config.resetConfig();
    const session = await import('@/lib/session');
    session.resetAuth();
    rooms = await import('@/lib/rooms');
    recording = await import('@/lib/recording');
    health = await import('@/lib/health');
    ({ POST: recordPOST } = await import('@/app/api/v0/bookings/[id]/record/route'));
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    const host = await MeetHost.create({
      ownerId: 'test-owner-recording-unconf',
      ownerEmail: 'unconf@example.com',
      slug: 'unconfhost',
      displayName: 'Unconf Host',
      timeZone: 'America/New_York',
    });
    const type = await MeetType.create({
      hostId: host._id,
      slug: 'unconf-call',
      name: 'Unconf call',
      lengthMinutes: 30,
      active: true,
      sort: 0,
    });
    const start = new Date(Date.now() - 60 * 1000);
    const booking = await MeetBooking.create({
      hostId: host._id,
      meetTypeId: type._id,
      guestName: 'Unconf Guest',
      guestEmail: 'guest@example.com',
      guestPhone: '',
      comments: '',
      start,
      end: new Date(start.getTime() + 30 * 60 * 1000),
      status: 'pending_calendar',
      calendarAttempts: 0,
    });
    await rooms.ensureBookingRoom(booking, type);
    bookingId = String(booking._id);

    const auth = session.getAuth();
    hostJwt = (
      await auth.createSessionWithDevice(
        { userId: 'test-owner-recording-unconf', email: 'unconf@example.com', accountLevel: 4 },
        { userAgent: 'vitest' },
      )
    ).jwt;
  }, 30000);

  afterAll(async () => {
    await mongoose?.disconnect();
  });

  it('refuses to start with recording_not_configured, at the lib and the route', async () => {
    const booking = await MeetBooking.findById(bookingId);
    await expect(recording.startRecording(booking!)).rejects.toMatchObject({
      code: 'recording_not_configured',
    });

    const res = await recordPOST(
      new Request(`http://test.local/api/v0/bookings/${bookingId}/record`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://test.local',
          cookie: `red_session=${hostJwt}`,
        },
        body: JSON.stringify({ action: 'start' }),
      }),
      { params: Promise.resolve({ id: bookingId }) },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string; error: string };
    expect(body.code).toBe('recording_not_configured');
    expect(body.error).toContain('not set up');

    const fresh = await MeetBooking.findById(bookingId);
    expect(fresh?.recordingStatus).toBe('idle');
  });

  it('reports health green with recording honestly off', async () => {
    const check = await health.checkRecordingStorage();
    expect(check.ok).toBe(true);
    expect(check.detail).toContain('not configured');
  });
});
