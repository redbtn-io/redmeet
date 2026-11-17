/**
 * Auto record tests (Epic 9).
 *
 * Against a real MongoDB (TEST_MONGODB_URI, skips without it,
 * own database names like the other suites) and a FAKE LiveKit
 * server speaking Twirp JSON for the room service and the
 * Egress service, the recording.test.ts pattern. Host routes
 * are driven with forged redauth device sessions.
 *
 * Covered:
 *   - the meeting type setting: validates through the core
 *     schema, serves resolved (default off), patches on and off
 *   - the trigger: the first successful mint inside the window
 *     starts the recording, exactly once, whoever mints first
 *   - capacity: four busy lanes refuse the auto start, the
 *     booking stays idle, the claim is handed back, and a
 *     later mint retries and starts
 *   - a host stop is final: no auto restart afterwards, even
 *     if the booking is presented idle again
 *   - manual recording on a non-auto booking is unchanged
 *   - join-info carries willRecord only when the meeting
 *     records automatically
 *   - instant meetings take the toggle at creation and auto
 *     start on the first guest mint
 */
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URI = process.env.TEST_MONGODB_URI;

function ownDbUri(uri: string, name: string): string {
  const [base = '', query] = uri.split('?');
  const trimmed = base.replace(/\/[^/]*$/, '');
  return `${trimmed}/${name}${query ? `?${query}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Fake LiveKit: room service + egress over Twirp JSON                 */
/* ------------------------------------------------------------------ */

interface FakeEgressJob {
  egressId: string;
  roomName: string;
  status: string;
}

const egressJobs = new Map<string, FakeEgressJob>();
const egressStarts: string[] = [];
let egressSeq = 0;

function egressInfoJson(job: FakeEgressJob): Record<string, unknown> {
  return {
    egressId: job.egressId,
    roomId: 'RM_fake',
    roomName: job.roomName,
    status: job.status,
    startedAt: '1700000000000000000',
    endedAt: '0',
    updatedAt: '1700000000000000000',
    error: '',
    fileResults: [],
    streamResults: [],
    segmentResults: [],
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
        send({ participants: [] });
        return;
      }
      if (url.endsWith('/DeleteRoom') || url.endsWith('/RemoveParticipant')) {
        send({});
        return;
      }
      if (url.endsWith('/StartRoomCompositeEgress')) {
        egressSeq += 1;
        const job: FakeEgressJob = {
          egressId: `EG_fake_${egressSeq}`,
          roomName: String(body.roomName ?? ''),
          status: 'EGRESS_ACTIVE',
        };
        egressJobs.set(job.egressId, job);
        egressStarts.push(job.roomName);
        send(egressInfoJson(job));
        return;
      }
      if (url.endsWith('/StopEgress')) {
        const job = egressJobs.get(String(body.egressId ?? ''));
        if (job) job.status = 'EGRESS_ENDING';
        send(job ? egressInfoJson(job) : {});
        return;
      }
      if (url.endsWith('/ListEgress')) {
        let jobs = [...egressJobs.values()];
        if (typeof body.egressId === 'string' && body.egressId) {
          jobs = jobs.filter((j) => j.egressId === body.egressId);
        }
        if (body.active === true) {
          jobs = jobs.filter((j) =>
            ['EGRESS_STARTING', 'EGRESS_ACTIVE', 'EGRESS_ENDING'].includes(j.status),
          );
        }
        send({ items: jobs.map(egressInfoJson) });
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

/* ------------------------------------------------------------------ */

describe.skipIf(!TEST_URI)('auto record (Epic 9)', () => {
  let mongoose: typeof import('mongoose').default;
  let rooms: typeof import('@/lib/rooms');
  let recording: typeof import('@/lib/recording');
  let typesPOST: typeof import('@/app/api/v0/meeting-types/route').POST;
  let typePATCH: typeof import('@/app/api/v0/meeting-types/[id]/route').PATCH;
  let instantPOST: typeof import('@/app/api/v0/instant-meetings/route').POST;
  let recordPOST: typeof import('@/app/api/v0/bookings/[id]/record/route').POST;
  let guestTokenGET: typeof import('@/app/api/public/bookings/[id]/room-token/route').GET;
  let hostTokenPOST: typeof import('@/app/api/v0/bookings/[id]/room-token/route').POST;
  let joinInfoGET: typeof import('@/app/api/public/bookings/[id]/join-info/route').GET;
  let MeetHost: typeof import('@/models/meet-host').MeetHost;
  let MeetType: typeof import('@/models/meet-type').MeetType;
  let MeetBooking: typeof import('@/models/meet-booking').MeetBooking;

  type BookingDoc = import('mongoose').HydratedDocument<
    import('@/models/meet-booking').MeetBookingDoc
  >;
  type HostDoc = import('mongoose').HydratedDocument<import('@/models/meet-host').MeetHostDoc>;
  type TypeDoc = import('mongoose').HydratedDocument<import('@/models/meet-type').MeetTypeDoc>;

  let host: HostDoc;
  let type: TypeDoc;
  let hostJwt: string;
  let fake: { server: Server; url: string };

  async function makeBooking(overrides: Record<string, unknown> = {}): Promise<BookingDoc> {
    const start = new Date(Date.now() - 60 * 1000);
    const booking = await MeetBooking.create({
      hostId: host._id,
      meetTypeId: type._id,
      guestName: 'Auto Guest',
      guestEmail: 'guest@example.com',
      guestPhone: '',
      comments: '',
      start,
      end: new Date(start.getTime() + 30 * 60 * 1000),
      status: 'pending_calendar',
      calendarAttempts: 0,
      ...overrides,
    });
    await rooms.ensureBookingRoom(booking, type);
    return booking;
  }

  function guestMint(booking: BookingDoc, query = ''): Promise<Response> {
    return guestTokenGET(
      new Request(
        `http://test.local/api/public/bookings/${booking.id}/room-token?t=${booking.guestJoinToken}${query}`,
      ),
      { params: Promise.resolve({ id: booking.id }) },
    );
  }

  function recordAction(id: string, action: string): Promise<Response> {
    return recordPOST(
      new Request(`http://test.local/api/v0/bookings/${id}/record`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://test.local',
          cookie: `red_session=${hostJwt}`,
        },
        body: JSON.stringify({ action }),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  /** Mark every fake Egress job complete, freeing all four lanes. */
  function clearLanes(): void {
    for (const job of egressJobs.values()) job.status = 'EGRESS_COMPLETE';
  }

  async function freshBooking(id: string): Promise<BookingDoc> {
    const doc = await MeetBooking.findById(id);
    if (!doc) throw new Error('booking vanished');
    return doc;
  }

  beforeAll(async () => {
    fake = await startFakeLiveKit();
    process.env.MONGODB_URI = ownDbUri(TEST_URI!, 'redmeet-autorecord-test');
    process.env.AUTH_MONGODB_URI = ownDbUri(TEST_URI!, 'redmeet-autorecord-auth-test');
    process.env.JWT_SECRET = 'autorecord-test-secret-that-is-long-enough-0123456789';
    process.env.REDMEET_DEFAULT_BRAND_ID = 'redbtn';
    process.env.BASE_URL = 'https://meet.redbtn.io';
    process.env.LIVEKIT_URL = fake.url;
    process.env.LIVEKIT_API_KEY = 'autorecord-test-key';
    process.env.LIVEKIT_API_SECRET = 'autorecord-test-secret-that-is-long-enough';
    process.env.S3_ENDPOINT = 'http://127.0.0.1:9';
    process.env.S3_BUCKET = 'redmeet-recordings';
    process.env.S3_ACCESS_KEY_ID = 'autorecord-test-key';
    process.env.S3_SECRET_ACCESS_KEY = 'autorecord-test-secret';
    process.env.S3_FORCE_PATH_STYLE = 'true';

    mongoose = (await import('mongoose')).default;
    await mongoose.connect(process.env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    const config = await import('@/lib/config');
    config.resetConfig();
    const session = await import('@/lib/session');
    session.resetAuth();
    rooms = await import('@/lib/rooms');
    recording = await import('@/lib/recording');
    ({ POST: typesPOST } = await import('@/app/api/v0/meeting-types/route'));
    ({ PATCH: typePATCH } = await import('@/app/api/v0/meeting-types/[id]/route'));
    ({ POST: instantPOST } = await import('@/app/api/v0/instant-meetings/route'));
    ({ POST: recordPOST } = await import('@/app/api/v0/bookings/[id]/record/route'));
    ({ GET: guestTokenGET } = await import('@/app/api/public/bookings/[id]/room-token/route'));
    ({ POST: hostTokenPOST } = await import('@/app/api/v0/bookings/[id]/room-token/route'));
    ({ GET: joinInfoGET } = await import('@/app/api/public/bookings/[id]/join-info/route'));
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    host = await MeetHost.create({
      ownerId: 'autorecord-test-owner',
      ownerEmail: 'autohost@example.com',
      slug: 'autohost',
      displayName: 'Auto Host',
      timeZone: 'America/New_York',
    });
    type = await MeetType.create({
      hostId: host._id,
      slug: 'auto-type',
      name: 'Auto Type',
      description: '',
      lengthMinutes: 30,
    });
    const auth = session.getAuth();
    hostJwt = (
      await auth.createSessionWithDevice(
        { userId: 'autorecord-test-owner', email: 'autohost@example.com', accountLevel: 4 },
        { userAgent: 'vitest' },
      )
    ).jwt;
  }, 30000);

  afterAll(async () => {
    fake?.server?.close();
    await mongoose?.disconnect();
  });

  it('the meeting type setting validates, serves resolved, and patches', async () => {
    const create = (body: unknown) =>
      typesPOST(
        new Request('http://test.local/api/v0/meeting-types', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://test.local',
            cookie: `red_session=${hostJwt}`,
          },
          body: JSON.stringify(body),
        }),
      );

    const on = await create({ slug: 'rec-on', name: 'Rec On', recordAutomatically: true });
    expect(on.status).toBe(201);
    const onJson = (await on.json()) as { meetingType: { id: string; recordAutomatically: boolean } };
    expect(onJson.meetingType.recordAutomatically).toBe(true);

    const off = await create({ slug: 'rec-off', name: 'Rec Off' });
    expect(off.status).toBe(201);
    const offJson = (await off.json()) as { meetingType: { recordAutomatically: boolean } };
    expect(offJson.meetingType.recordAutomatically).toBe(false);

    const bad = await create({ slug: 'rec-bad', name: 'Rec Bad', recordAutomatically: 'yes' });
    expect(bad.status).toBe(400);

    const patched = await typePATCH(
      new Request(`http://test.local/api/v0/meeting-types/${onJson.meetingType.id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          origin: 'http://test.local',
          cookie: `red_session=${hostJwt}`,
        },
        body: JSON.stringify({ recordAutomatically: false }),
      }),
      { params: Promise.resolve({ id: onJson.meetingType.id }) },
    );
    expect(patched.status).toBe(200);
    const patchedJson = (await patched.json()) as {
      meetingType: { recordAutomatically: boolean };
    };
    expect(patchedJson.meetingType.recordAutomatically).toBe(false);
  });

  it('auto start fires exactly once, and a later mint finds it running', async () => {
    const booking = await makeBooking({ recordAutomatically: true });
    const before = egressStarts.length;

    expect(await recording.maybeAutoStartRecording(booking)).toBe('started');
    expect(booking.recordingStatus).toBe('recording');
    expect(egressStarts.length).toBe(before + 1);

    expect(await recording.maybeAutoStartRecording(booking)).toBe('already');
    expect(egressStarts.length).toBe(before + 1);

    const stored = await freshBooking(booking.id);
    expect(stored.recordingStatus).toBe('recording');
    expect(stored.recordingAutoClaimedAt).toBeTruthy();
  });

  it('the first guest mint through the real route starts the recording', async () => {
    const booking = await makeBooking({ recordAutomatically: true });
    const before = egressStarts.length;

    const res = await guestMint(booking);
    expect(res.status).toBe(200);
    expect(egressStarts.length).toBe(before + 1);
    expect(egressStarts[egressStarts.length - 1]).toBe(booking.roomId);

    const stored = await freshBooking(booking.id);
    expect(stored.recordingStatus).toBe('recording');

    // A second mint (the host's) starts nothing new.
    const hostRes = await hostTokenPOST(
      new Request(`http://test.local/api/v0/bookings/${booking.id}/room-token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://test.local',
          cookie: `red_session=${hostJwt}`,
        },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: booking.id }) },
    );
    expect(hostRes.status).toBe(200);
    expect(egressStarts.length).toBe(before + 1);
  });

  it('capacity refusal leaves the booking idle and a later mint retries', async () => {
    const foreign: FakeEgressJob[] = [];
    for (let i = 0; i < 4; i += 1) {
      const job: FakeEgressJob = {
        egressId: `EG_foreign_${i}`,
        roomName: 'someone-elses-room',
        status: 'EGRESS_ACTIVE',
      };
      egressJobs.set(job.egressId, job);
      foreign.push(job);
    }
    try {
      const booking = await makeBooking({ recordAutomatically: true });
      const before = egressStarts.length;
      expect(await recording.maybeAutoStartRecording(booking)).toBe('capacity');
      expect(egressStarts.length).toBe(before);
      const stored = await freshBooking(booking.id);
      expect(stored.recordingStatus).toBe('idle');
      // The claim was handed back, so a later mint can retry.
      expect(stored.recordingAutoClaimedAt ?? null).toBeNull();

      // The lanes free up; the retry starts.
      for (const job of foreign) egressJobs.delete(job.egressId);
      expect(await recording.maybeAutoStartRecording(booking)).toBe('started');
      expect(egressStarts.length).toBe(before + 1);
    } finally {
      for (const job of foreign) egressJobs.delete(job.egressId);
    }
  });

  it('a host stop is final: auto record never restarts', async () => {
    const booking = await makeBooking({ recordAutomatically: true });
    expect(await recording.maybeAutoStartRecording(booking)).toBe('started');
    const before = egressStarts.length;

    const stop = await recordAction(booking.id, 'stop');
    expect(stop.status).toBe(200);
    let stored = await freshBooking(booking.id);
    expect(stored.recordingStatus).toBe('processing');
    expect(stored.recordingAutoStoppedByHostAt).toBeTruthy();

    expect(await recording.maybeAutoStartRecording(stored)).not.toBe('started');
    expect(egressStarts.length).toBe(before);

    // Even if the booking were presented idle again, the
    // host stop flag is the guard and it holds.
    await MeetBooking.updateOne(
      { _id: booking._id },
      {
        $set: { recordingStatus: 'idle' },
        $unset: { recordingEgressId: 1, recordingAutoClaimedAt: 1 },
      },
    );
    stored = await freshBooking(booking.id);
    expect(await recording.maybeAutoStartRecording(stored)).toBe('skipped');
    expect(egressStarts.length).toBe(before);
  });

  it('manual recording on a non-auto booking is unchanged', async () => {
    clearLanes();
    const booking = await makeBooking();
    const before = egressStarts.length;
    expect(await recording.maybeAutoStartRecording(booking)).toBe('skipped');
    expect(egressStarts.length).toBe(before);

    const start = await recordAction(booking.id, 'start');
    expect(start.status).toBe(200);
    expect(egressStarts.length).toBe(before + 1);
    const stop = await recordAction(booking.id, 'stop');
    expect(stop.status).toBe(200);
    const stored = await freshBooking(booking.id);
    expect(stored.recordingStatus).toBe('processing');
    expect(stored.recordingAutoStoppedByHostAt ?? null).toBeNull();
  });

  it('join-info carries willRecord only when the meeting records automatically', async () => {
    const auto = await makeBooking({ recordAutomatically: true });
    const autoRes = await joinInfoGET(
      new Request(
        `http://test.local/api/public/bookings/${auto.id}/join-info?t=${auto.guestJoinToken}`,
      ),
      { params: Promise.resolve({ id: auto.id }) },
    );
    expect(autoRes.status).toBe(200);
    expect(((await autoRes.json()) as { willRecord?: boolean }).willRecord).toBe(true);

    const plain = await makeBooking();
    const plainRes = await joinInfoGET(
      new Request(
        `http://test.local/api/public/bookings/${plain.id}/join-info?t=${plain.guestJoinToken}`,
      ),
      { params: Promise.resolve({ id: plain.id }) },
    );
    expect(plainRes.status).toBe(200);
    expect(((await plainRes.json()) as { willRecord?: boolean }).willRecord).toBe(false);
  });

  it('instant meetings take the toggle at creation and auto start on the first mint', async () => {
    clearLanes();
    const createInstant = (body: unknown) =>
      instantPOST(
        new Request('http://test.local/api/v0/instant-meetings', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://test.local',
            cookie: `red_session=${hostJwt}`,
          },
          body: JSON.stringify(body),
        }),
      );

    const on = await createInstant({ title: 'Auto instant', recordAutomatically: true });
    expect(on.status).toBe(201);
    const onJson = (await on.json()) as {
      booking: { id: string; recordAutomatically: boolean; guestJoinToken: string };
    };
    expect(onJson.booking.recordAutomatically).toBe(true);

    const before = egressStarts.length;
    const mint = await guestTokenGET(
      new Request(
        `http://test.local/api/public/bookings/${onJson.booking.id}/room-token?t=${onJson.booking.guestJoinToken}&g=33333333-3333-4333-8333-333333333333`,
      ),
      { params: Promise.resolve({ id: onJson.booking.id }) },
    );
    expect(mint.status).toBe(200);
    expect(egressStarts.length).toBe(before + 1);
    const stored = await freshBooking(onJson.booking.id);
    expect(stored.recordingStatus).toBe('recording');

    const off = await createInstant({ title: 'Manual instant' });
    expect(off.status).toBe(201);
    const offJson = (await off.json()) as {
      booking: { id: string; recordAutomatically: boolean; guestJoinToken: string };
    };
    expect(offJson.booking.recordAutomatically).toBe(false);
    const mint2 = await guestTokenGET(
      new Request(
        `http://test.local/api/public/bookings/${offJson.booking.id}/room-token?t=${offJson.booking.guestJoinToken}&g=44444444-4444-4444-8444-444444444444`,
      ),
      { params: Promise.resolve({ id: offJson.booking.id }) },
    );
    expect(mint2.status).toBe(200);
    expect(egressStarts.length).toBe(before + 1);
  });
});
