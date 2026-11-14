/**
 * Recording tests (Epic 6).
 *
 * Against a real MongoDB (TEST_MONGODB_URI, skips without it,
 * own database names like the other suites), a FAKE LiveKit
 * server speaking Twirp JSON for both the room service and
 * the Egress service (jobs the test controls end to end), and
 * a FAKE S3 server (an HTTP stub that stores objects and
 * honors Range, which is all the playback route's read path
 * exercises). Host routes are driven with forged redauth
 * device sessions, the moderation.test.ts pattern.
 *
 * Covered:
 *   - the state machine: idle to recording to processing to
 *     ready, with duration and size from the file result
 *   - a failed Egress job settles failed with its reason,
 *     never ready; a vanished job settles failed as lost
 *   - capacity: four active lanes cluster wide refuse the
 *     next start with the egress_capacity code, booking idle
 *   - the record route gate: anonymous 401, stranger 404,
 *     owner 200, and the already recording refusal
 *   - the playback route: owner streams the file, Range gets
 *     a 206 with Content-Range, download flips disposition,
 *     stranger 404, anonymous 401, not ready 409
 *   - the guest surface: join-info carries the recording
 *     state and no storage reference or Egress id anywhere
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
  error?: string;
  fileResults?: Array<Record<string, string>>;
}

const egressJobs = new Map<string, FakeEgressJob>();
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
    error: job.error ?? '',
    fileResults: job.fileResults ?? [],
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
/* Fake S3: stores objects, honors Range                               */
/* ------------------------------------------------------------------ */

const s3Objects = new Map<string, Buffer>();

async function startFakeS3(): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://fake-s3');
      const key = decodeURIComponent(url.pathname.replace(/^\/redmeet-recordings\//, ''));
      if (req.method === 'PUT') {
        s3Objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"fake-etag"' });
        res.end();
        return;
      }
      const data = s3Objects.get(key);
      if (!data) {
        res.writeHead(404, { 'content-type': 'application/xml' });
        res.end('<Error><Code>NoSuchKey</Code></Error>');
        return;
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          'content-type': 'video/mp4',
          'content-length': String(data.length),
          etag: '"fake-etag"',
        });
        res.end();
        return;
      }
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (match) {
          const start = Number(match[1]);
          const end = match[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
          const slice = data.subarray(start, end + 1);
          res.writeHead(206, {
            'content-type': 'video/mp4',
            'content-length': String(slice.length),
            'content-range': `bytes ${start}-${end}/${data.length}`,
            'accept-ranges': 'bytes',
            etag: '"fake-etag"',
          });
          res.end(slice);
          return;
        }
      }
      res.writeHead(200, {
        'content-type': 'video/mp4',
        'content-length': String(data.length),
        'accept-ranges': 'bytes',
        etag: '"fake-etag"',
      });
      res.end(data);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, url: `http://127.0.0.1:${port}` };
}

/* ------------------------------------------------------------------ */

describe.skipIf(!TEST_URI)('recording (Epic 6)', () => {
  let mongoose: typeof import('mongoose').default;
  let rooms: typeof import('@/lib/rooms');
  let recording: typeof import('@/lib/recording');
  let recordPOST: typeof import('@/app/api/v0/bookings/[id]/record/route').POST;
  let recordingGET: typeof import('@/app/api/v0/bookings/[id]/recording/route').GET;
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
  let otherJwt: string;
  let fakeLiveKit: { server: Server; url: string };
  let fakeS3: { server: Server; url: string };

  async function makeBooking(guestName: string): Promise<BookingDoc> {
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

  function record(jwt: string | null, id: string, action: string): Promise<Response> {
    return recordPOST(
      new Request(`http://test.local/api/v0/bookings/${id}/record`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://test.local',
          ...(jwt ? { cookie: `red_session=${jwt}` } : {}),
        },
        body: JSON.stringify({ action }),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  function play(jwt: string | null, id: string, query = '', headers: Record<string, string> = {}): Promise<Response> {
    return recordingGET(
      new Request(`http://test.local/api/v0/bookings/${id}/recording${query}`, {
        headers: { ...(jwt ? { cookie: `red_session=${jwt}` } : {}), ...headers },
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  beforeAll(async () => {
    fakeLiveKit = await startFakeLiveKit();
    fakeS3 = await startFakeS3();
    process.env.MONGODB_URI = ownDbUri(TEST_URI!, 'redmeet-recording-test');
    process.env.AUTH_MONGODB_URI = ownDbUri(TEST_URI!, 'redmeet-recording-auth-test');
    process.env.JWT_SECRET = 'recording-test-jwt-secret-that-is-long';
    process.env.REDMEET_DEFAULT_BRAND_ID = 'redbtn';
    process.env.BASE_URL = 'https://meet.redbtn.io';
    process.env.LIVEKIT_URL = fakeLiveKit.url;
    process.env.LIVEKIT_API_KEY = 'APIrecordingTestKey';
    process.env.LIVEKIT_API_SECRET = 'recording-test-secret-that-is-long-enough';
    process.env.S3_ENDPOINT = fakeS3.url;
    process.env.S3_BUCKET = 'redmeet-recordings';
    process.env.S3_ACCESS_KEY_ID = 'recording-test-key';
    process.env.S3_SECRET_ACCESS_KEY = 'recording-test-secret';
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
    ({ POST: recordPOST } = await import('@/app/api/v0/bookings/[id]/record/route'));
    ({ GET: recordingGET } = await import('@/app/api/v0/bookings/[id]/recording/route'));
    ({ GET: joinInfoGET } = await import('@/app/api/public/bookings/[id]/join-info/route'));
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    host = await MeetHost.create({
      ownerId: 'test-owner-recording',
      ownerEmail: 'rechost@example.com',
      slug: 'rechost',
      displayName: 'Rec Host',
      timeZone: 'America/New_York',
    });
    type = await MeetType.create({
      hostId: host._id,
      slug: 'rec-call',
      name: 'Rec call',
      lengthMinutes: 30,
      active: true,
      sort: 0,
    });
    const auth = session.getAuth();
    hostJwt = (
      await auth.createSessionWithDevice(
        { userId: 'test-owner-recording', email: 'rechost@example.com', accountLevel: 4 },
        { userAgent: 'vitest' },
      )
    ).jwt;
    otherJwt = (
      await auth.createSessionWithDevice(
        { userId: 'test-owner-stranger6', email: 'stranger6@example.com', accountLevel: 4 },
        { userAgent: 'vitest' },
      )
    ).jwt;
  }, 30000);

  afterAll(async () => {
    await mongoose?.disconnect();
    fakeLiveKit?.server.close();
    fakeS3?.server.close();
  });

  it('walks idle to recording to processing to ready with duration and size', async () => {
    const booking = await makeBooking('State Guest');
    expect(booking.recordingStatus).toBe('idle');

    await recording.startRecording(booking);
    expect(booking.recordingStatus).toBe('recording');
    expect(booking.recordingEgressId).toBeTruthy();
    expect(booking.recordingKey).toBe(`recordings/${String(booking._id)}.mp4`);
    expect(booking.recordingStartedAt).toBeTruthy();

    await expect(recording.startRecording(booking)).rejects.toMatchObject({
      code: 'already_recording',
    });

    await recording.stopRecording(booking);
    expect(booking.recordingStatus).toBe('processing');
    expect(booking.recordingStoppedAt).toBeTruthy();

    const job = egressJobs.get(booking.recordingEgressId!);
    expect(job).toBeTruthy();
    job!.status = 'EGRESS_COMPLETE';
    job!.fileResults = [
      {
        filename: booking.recordingKey!,
        startedAt: '1700000000000000000',
        endedAt: '1700000125000000000',
        duration: '125000000000',
        size: '12345678',
        location: 'http://fake-s3-must-not-leak/redmeet-recordings/x.mp4',
      },
    ];
    await recording.refreshRecording(booking);
    expect(booking.recordingStatus).toBe('ready');
    expect(booking.recordingDurationSeconds).toBe(125);
    expect(booking.recordingSizeBytes).toBe(12345678);
  });

  it('marks a failed egress failed with its reason, never ready', async () => {
    const booking = await makeBooking('Fail Guest');
    await recording.startRecording(booking);
    const job = egressJobs.get(booking.recordingEgressId!);
    job!.status = 'EGRESS_FAILED';
    job!.error = 'encoder died';
    await recording.refreshRecording(booking);
    expect(booking.recordingStatus).toBe('failed');
    expect(booking.recordingError).toContain('encoder died');
  });

  it('marks a vanished egress job failed as lost', async () => {
    const booking = await makeBooking('Lost Guest');
    await recording.startRecording(booking);
    egressJobs.delete(booking.recordingEgressId!);
    await recording.refreshRecording(booking);
    expect(booking.recordingStatus).toBe('failed');
    expect(booking.recordingError).toContain('lost');
  });

  it('refuses to start when every lane is busy, and the booking stays idle', async () => {
    // Fill the cluster: four active foreign jobs (redCast's, say).
    const fillers: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const id = `EG_foreign_${i}`;
      egressJobs.set(id, { egressId: id, roomName: 'someone-else', status: 'EGRESS_ACTIVE' });
      fillers.push(id);
    }
    try {
      const booking = await makeBooking('Capacity Guest');
      await expect(recording.startRecording(booking)).rejects.toMatchObject({
        code: 'egress_capacity',
      });
      const fresh = await MeetBooking.findById(booking._id);
      expect(fresh?.recordingStatus).toBe('idle');
    } finally {
      fillers.forEach((id) => egressJobs.delete(id));
    }
  });

  it('gates the record route: anonymous 401, stranger 404, owner starts and stops', async () => {
    const booking = await makeBooking('Route Guest');
    const id = String(booking._id);

    expect((await record(null, id, 'start')).status).toBe(401);
    expect((await record(otherJwt, id, 'start')).status).toBe(404);

    const started = await record(hostJwt, id, 'start');
    expect(started.status).toBe(200);
    const startedBody = (await started.json()) as { recording: { status: string } };
    expect(startedBody.recording.status).toBe('recording');

    const again = await record(hostJwt, id, 'start');
    expect(again.status).toBe(409);
    expect(((await again.json()) as { code: string }).code).toBe('already_recording');

    const stopped = await record(hostJwt, id, 'stop');
    expect(stopped.status).toBe(200);
    expect(((await stopped.json()) as { recording: { status: string } }).recording.status).toBe(
      'processing',
    );
  });

  it('serves the file to the owner only, with range and download', async () => {
    const booking = await makeBooking('Play Guest');
    const id = String(booking._id);
    const bytes = Buffer.from('fake-mp4-bytes-0123456789');
    const key = `recordings/${id}.mp4`;
    s3Objects.set(key, bytes);
    booking.recordingStatus = 'ready';
    booking.recordingKey = key;
    booking.recordingDurationSeconds = 25;
    booking.recordingSizeBytes = bytes.length;
    await booking.save();

    expect((await play(null, id)).status).toBe(401);
    expect((await play(otherJwt, id)).status).toBe(404);

    const full = await play(hostJwt, id);
    expect(full.status).toBe(200);
    expect(full.headers.get('content-type')).toContain('video/mp4');
    expect(await full.text()).toBe(bytes.toString());

    const ranged = await play(hostJwt, id, '', { range: 'bytes=0-3' });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe(`bytes 0-3/${bytes.length}`);
    expect(await ranged.text()).toBe('fake');

    const download = await play(hostJwt, id, '?download=1');
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(download.headers.get('content-disposition')).toContain(`${id}.mp4`);
  });

  it('answers 409 for a booking with no ready recording', async () => {
    const booking = await makeBooking('Not Ready Guest');
    const res = await play(hostJwt, String(booking._id));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('recording_not_ready');
  });

  it('gives guests the recording state and nothing about the file', async () => {
    const booking = await makeBooking('Guest View Guest');
    await recording.startRecording(booking);
    const res = await joinInfoGET(
      new Request(`http://test.local/api/public/bookings/${String(booking._id)}/join-info?t=${booking.guestJoinToken}`),
      { params: Promise.resolve({ id: String(booking._id) }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recording: { status: string; active: boolean } };
    expect(body.recording.status).toBe('recording');
    expect(body.recording.active).toBe(true);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(booking.recordingEgressId!);
    expect(raw).not.toContain('recordings/');
    expect(raw).not.toContain('fake-s3');
  });
});
