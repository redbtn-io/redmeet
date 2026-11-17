/**
 * Instant meetings integration tests (Epic 8).
 *
 * Against a real MongoDB (TEST_MONGODB_URI, skips without it,
 * own database name like the other suites) and a FAKE LiveKit
 * server: the same Twirp stub shape as the settings and
 * recording suites, extended with the mute and egress calls,
 * with a participant list the test controls.
 *
 * Covered here, per the Epic 8 stories:
 *   - creating an instant meeting opens its room immediately,
 *     with the settings defaults stamped (lifetime window,
 *     participant limit, entry mode the host picked)
 *   - the create route is host gated and returns the share link
 *   - two guests through the SAME link get different identities
 *     and coexist; the same guest key rejoins as the same
 *     identity; a mint without a guest key is refused
 *   - the participant limit refuses the next guest at mint
 *   - a removed guest stays removed while the other guests on
 *     the same link are unaffected
 *   - waiting room admission is per guest: one guest admitted,
 *     another denied, neither decision touches the other
 *   - an expired instant meeting refuses mints as closed
 *   - host controls (mute, end) and the recording routes work
 *     on instant meetings through the same endpoints booked
 *     meetings use
 *   - a booked meeting still mints its one guest identity with
 *     no guest key anywhere, unchanged
 */
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URI = process.env.TEST_MONGODB_URI;

function ownDbUri(uri: string): string {
  const [base = '', query] = uri.split('?');
  const trimmed = base.replace(/\/[^/]*$/, '');
  return `${trimmed}/redmeet-instant-test${query ? `?${query}` : ''}`;
}

/* ------------------------------------------------------------------ */
/* Fake LiveKit: room service + egress over Twirp JSON                 */
/* ------------------------------------------------------------------ */

/** Participant identities per room name, controlled by the tests. */
const fakeParticipants = new Map<string, string[]>();
/** Mute calls the fake received, as "room identity trackSid". */
const muteCalls: string[] = [];

function fakeParticipant(identity: string) {
  return {
    sid: `PA_${identity}`,
    identity,
    state: 2,
    tracks: [
      {
        sid: `TR_mic_${identity}`,
        type: 0,
        name: 'microphone',
        source: 2, // TrackSource.MICROPHONE
        muted: false,
        width: 0,
        height: 0,
        simulcast: false,
        disableDtx: false,
        mimeType: 'audio/opus',
        mid: '0',
        layers: [],
      },
    ],
    metadata: '',
    joinedAt: '1700000000',
    kind: 0,
    version: 0,
    name: identity,
    attributes: {},
  };
}

interface FakeEgressJob {
  egressId: string;
  roomName: string;
  status: string;
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
        const room = String(body.room ?? '');
        send({ participants: (fakeParticipants.get(room) ?? []).map(fakeParticipant) });
        return;
      }
      if (url.endsWith('/MutePublishedTrack')) {
        muteCalls.push(`${body.room} ${body.identity} ${body.trackSid}`);
        send({});
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

const KEY_A = '11111111-2222-4333-8444-555555555555';
const KEY_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const KEY_C = '99999999-8888-4777-8666-555555555555';

describe.skipIf(!TEST_URI)('instant meetings (Epic 8)', () => {
  let mongoose: typeof import('mongoose').default;
  let session: typeof import('@/lib/session');
  let instant: typeof import('@/lib/instant');
  let rooms: typeof import('@/lib/rooms');
  let resetConfig: typeof import('@/lib/config').resetConfig;
  let instantPOST: typeof import('@/app/api/v0/instant-meetings/route').POST;
  let guestTokenGET: typeof import('@/app/api/public/bookings/[id]/room-token/route').GET;
  let joinInfoGET: typeof import('@/app/api/public/bookings/[id]/join-info/route').GET;
  let waitingRoomPOST: typeof import('@/app/api/public/bookings/[id]/waiting-room/route').POST;
  let hostTokenPOST: typeof import('@/app/api/v0/bookings/[id]/room-token/route').POST;
  let moderatePOST: typeof import('@/app/api/v0/bookings/[id]/moderate/route').POST;
  let waitingGET: typeof import('@/app/api/v0/bookings/[id]/waiting/route').GET;
  let recordPOST: typeof import('@/app/api/v0/bookings/[id]/record/route').POST;
  let recordGET: typeof import('@/app/api/v0/bookings/[id]/record/route').GET;
  let extendPOST: typeof import('@/app/api/v0/bookings/[id]/extend-room/route').POST;
  let MeetHost: typeof import('@/models/meet-host').MeetHost;
  let MeetType: typeof import('@/models/meet-type').MeetType;
  let MeetBooking: typeof import('@/models/meet-booking').MeetBooking;

  type HostDoc = import('mongoose').HydratedDocument<import('@/models/meet-host').MeetHostDoc>;
  type BookingDoc = import('mongoose').HydratedDocument<
    import('@/models/meet-booking').MeetBookingDoc
  >;

  let host: HostDoc;
  let hostJwt: string;
  let fake: { server: Server; url: string };

  function hostCall(
    handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>,
    id: string,
    body?: Record<string, unknown>,
    jwt: string | null = hostJwt,
  ): Promise<Response> {
    return handler(
      new Request(`http://test.local/api/v0/bookings/${id}/x`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://test.local',
          ...(jwt ? { cookie: `red_session=${jwt}` } : {}),
        },
        body: JSON.stringify(body ?? {}),
      }),
      { params: Promise.resolve({ id }) },
    );
  }

  function guestMint(id: string, t: string, query = ''): Promise<Response> {
    return guestTokenGET(
      new Request(`http://test.local/api/public/bookings/${id}/room-token?t=${t}${query}`),
      { params: Promise.resolve({ id }) },
    );
  }

  function guestInfo(id: string, t: string, query = ''): Promise<Response> {
    return joinInfoGET(
      new Request(`http://test.local/api/public/bookings/${id}/join-info?t=${t}${query}`),
      { params: Promise.resolve({ id }) },
    );
  }

  beforeAll(async () => {
    fake = await startFakeLiveKit();
    process.env.MONGODB_URI = ownDbUri(TEST_URI!);
    process.env.AUTH_MONGODB_URI = ownDbUri(TEST_URI!).replace(
      'redmeet-instant-test',
      'redmeet-instant-auth-test',
    );
    process.env.JWT_SECRET = '<redacted>';
    process.env.REDMEET_DEFAULT_BRAND_ID = 'redbtn';
    process.env.BASE_URL = 'https://meet.redbtn.io';
    process.env.LIVEKIT_URL = fake.url;
    process.env.LIVEKIT_API_KEY = 'instant-test-key';
    process.env.LIVEKIT_API_SECRET = 'instant-test-secret';
    process.env.S3_ENDPOINT = 'http://127.0.0.1:9';
    process.env.S3_BUCKET = 'redmeet-recordings';
    process.env.S3_ACCESS_KEY_ID = 'instant-test-key';
    process.env.S3_SECRET_ACCESS_KEY = 'instant-test-secret';
    process.env.S3_FORCE_PATH_STYLE = 'true';

    mongoose = (await import('mongoose')).default;
    await mongoose.connect(process.env.MONGODB_URI);
    await mongoose.connection.dropDatabase();
    ({ resetConfig } = await import('@/lib/config'));
    resetConfig();
    session = await import('@/lib/session');
    session.resetAuth();
    instant = await import('@/lib/instant');
    rooms = await import('@/lib/rooms');
    ({ POST: instantPOST } = await import('@/app/api/v0/instant-meetings/route'));
    ({ GET: guestTokenGET } = await import('@/app/api/public/bookings/[id]/room-token/route'));
    ({ GET: joinInfoGET } = await import('@/app/api/public/bookings/[id]/join-info/route'));
    ({ POST: waitingRoomPOST } = await import('@/app/api/public/bookings/[id]/waiting-room/route'));
    ({ POST: hostTokenPOST } = await import('@/app/api/v0/bookings/[id]/room-token/route'));
    ({ POST: moderatePOST } = await import('@/app/api/v0/bookings/[id]/moderate/route'));
    ({ GET: waitingGET } = await import('@/app/api/v0/bookings/[id]/waiting/route'));
    ({ POST: recordPOST, GET: recordGET } = await import('@/app/api/v0/bookings/[id]/record/route'));
    ({ POST: extendPOST } = await import('@/app/api/v0/bookings/[id]/extend-room/route'));
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    host = await MeetHost.create({
      ownerId: 'instant-test-owner',
      ownerEmail: 'instanthost@example.com',
      slug: 'instanthost',
      displayName: 'Instant Host',
    });
    const auth = session.getAuth();
    hostJwt = (
      await auth.createSessionWithDevice(
        { userId: 'instant-test-owner', email: 'instanthost@example.com', accountLevel: 4 },
        { userAgent: 'vitest' },
      )
    ).jwt;
  }, 30000);

  afterAll(async () => {
    fake?.server?.close();
    await mongoose?.disconnect();
  });

  it('the create route is host gated and returns a live meeting with a share link', async () => {
    const anon = await instantPOST(
      new Request('http://test.local/api/v0/instant-meetings', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://test.local' },
        body: JSON.stringify({}),
      }),
    );
    expect(anon.status).toBe(401);

    const res = await instantPOST(
      new Request('http://test.local/api/v0/instant-meetings', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://test.local',
          cookie: `red_session=${hostJwt}`,
        },
        body: JSON.stringify({ title: 'Quick sync', entryMode: 'open' }),
      }),
    );
    expect(res.status).toBe(201);
    const data = (await res.json()) as {
      booking: {
        id: string;
        kind: string;
        status: string;
        meetingName: string;
        entryMode: string;
        guestJoinUrl: string;
        roomExpiresAt: string;
        start: string;
        participantLimit: number;
      };
    };
    expect(data.booking.kind).toBe('instant');
    expect(data.booking.status).toBe('instant');
    expect(data.booking.meetingName).toBe('Quick sync');
    expect(data.booking.entryMode).toBe('open');
    expect(data.booking.participantLimit).toBe(10);
    expect(data.booking.guestJoinUrl).toContain(`/join/${data.booking.id}?t=`);
    // The window is the stamped lifetime: start plus 240 minutes.
    const span =
      new Date(data.booking.roomExpiresAt).getTime() - new Date(data.booking.start).getTime();
    expect(Math.abs(span - 240 * 60 * 1000)).toBeLessThan(5000);

    // And the record itself: no type, no slot status, no guest.
    const doc = await MeetBooking.findById(data.booking.id);
    expect(doc?.kind).toBe('instant');
    expect(doc?.meetTypeId ?? null).toBeNull();
    expect(doc?.guestEmail).toBe('');
    expect(doc?.calendarEventId).toBeUndefined();
    expect(rooms.roomPhase(doc!, new Date())).toBe('open');
  });

  it('creation opens the room immediately: the host mints at once', async () => {
    const meeting = await instant.createInstantMeeting(host, {});
    const res = await hostCall(hostTokenPOST, String(meeting._id), { displayName: 'Instant Host' });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { identity: string };
    expect(data.identity).toBe(rooms.hostIdentityFor(String(host._id)));
  });

  it('two guests through the same link get different identities and coexist', async () => {
    const meeting = await instant.createInstantMeeting(host, {});
    const id = String(meeting._id);
    const t = meeting.guestJoinToken!;

    const a = await guestMint(id, t, `&g=${KEY_A}&name=Ana`);
    expect(a.status).toBe(200);
    const aData = (await a.json()) as { identity: string; displayName: string };
    expect(aData.identity).toBe(`guest-${id}-${KEY_A}`);
    expect(aData.displayName).toBe('Ana');

    const b = await guestMint(id, t, `&g=${KEY_B}&name=Ben`);
    expect(b.status).toBe(200);
    const bData = (await b.json()) as { identity: string };
    expect(bData.identity).toBe(`guest-${id}-${KEY_B}`);
    expect(bData.identity).not.toBe(aData.identity);

    // The same guest key mints the same identity again: a drop
    // or a second tab rejoins as the same guest.
    const a2 = await guestMint(id, t, `&g=${KEY_A}&name=Ana`);
    expect(a2.status).toBe(200);
    expect(((await a2.json()) as { identity: string }).identity).toBe(aData.identity);
  });

  it('an instant guest mint without a guest key is refused', async () => {
    const meeting = await instant.createInstantMeeting(host, {});
    const res = await guestMint(String(meeting._id), meeting.guestJoinToken!);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('guest_key_required');
  });

  it('the participant limit refuses the next guest, never a seated one', async () => {
    const meeting = await instant.createInstantMeeting(host, {
      settings: { participantLimit: 2 },
    });
    const id = String(meeting._id);
    const t = meeting.guestJoinToken!;
    // The room already holds the host and guest A.
    fakeParticipants.set(meeting.roomId!, [
      rooms.hostIdentityFor(String(host._id)),
      `guest-${id}-${KEY_A}`,
    ]);
    const b = await guestMint(id, t, `&g=${KEY_B}&name=Ben`);
    expect(b.status).toBe(409);
    expect(((await b.json()) as { code: string }).code).toBe('room_full');
    // Guest A still holds their seat and mints again.
    const a = await guestMint(id, t, `&g=${KEY_A}&name=Ana`);
    expect(a.status).toBe(200);
    fakeParticipants.delete(meeting.roomId!);
  });

  it('a removed guest stays removed while the other guests are unaffected', async () => {
    const meeting = await instant.createInstantMeeting(host, {});
    const id = String(meeting._id);
    const t = meeting.guestJoinToken!;
    expect((await guestMint(id, t, `&g=${KEY_A}`)).status).toBe(200);
    expect((await guestMint(id, t, `&g=${KEY_B}`)).status).toBe(200);

    const removed = await hostCall(moderatePOST, id, {
      action: 'remove',
      identity: `guest-${id}-${KEY_A}`,
    });
    expect(removed.status).toBe(200);

    const a = await guestMint(id, t, `&g=${KEY_A}`);
    expect(a.status).toBe(403);
    expect(((await a.json()) as { code: string }).code).toBe('guest_removed');
    expect((await guestMint(id, t, `&g=${KEY_B}`)).status).toBe(200);

    const infoA = (await (await guestInfo(id, t, `&g=${KEY_A}`)).json()) as { removed: boolean };
    const infoB = (await (await guestInfo(id, t, `&g=${KEY_B}`)).json()) as { removed: boolean };
    expect(infoA.removed).toBe(true);
    expect(infoB.removed).toBe(false);
  });

  it('waiting room admission is per guest on an instant meeting', async () => {
    const meeting = await instant.createInstantMeeting(host, { entryMode: 'waiting_room' });
    const id = String(meeting._id);
    const t = meeting.guestJoinToken!;

    const ask = (key: string, name: string) =>
      waitingRoomPOST(
        new Request(`http://test.local/api/public/bookings/${id}/waiting-room?t=${t}&g=${key}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name }),
        }),
        { params: Promise.resolve({ id }) },
      );

    expect((await ask(KEY_A, 'Ana')).status).toBe(200);
    // Not admitted yet: no mint.
    const early = await guestMint(id, t, `&g=${KEY_A}`);
    expect(early.status).toBe(403);
    expect(((await early.json()) as { code: string }).code).toBe('admission_required');

    // The host sees Ana waiting, by identity, and no booked
    // style single admission.
    const waitingRes = await waitingGET(
      new Request(`http://test.local/api/v0/bookings/${id}/waiting`, {
        headers: { cookie: `red_session=${hostJwt}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    const waitingData = (await waitingRes.json()) as {
      admission: unknown;
      admissions: { identity: string; name: string; state: string }[];
    };
    expect(waitingData.admission).toBeNull();
    expect(waitingData.admissions).toHaveLength(1);
    expect(waitingData.admissions[0]).toMatchObject({
      identity: `guest-${id}-${KEY_A}`,
      name: 'Ana',
      state: 'waiting',
    });

    // Admitting without the guest identity is a bad request on
    // an instant meeting; with it, Ana is in.
    const noIdentity = await hostCall(moderatePOST, id, { action: 'admit' });
    expect(noIdentity.status).toBe(400);
    const admit = await hostCall(moderatePOST, id, {
      action: 'admit',
      identity: `guest-${id}-${KEY_A}`,
    });
    expect(admit.status).toBe(200);
    expect((await guestMint(id, t, `&g=${KEY_A}`)).status).toBe(200);

    // Ben asks and is denied; Ana's admission stands.
    expect((await ask(KEY_B, 'Ben')).status).toBe(200);
    const deny = await hostCall(moderatePOST, id, {
      action: 'deny',
      identity: `guest-${id}-${KEY_B}`,
    });
    expect(deny.status).toBe(200);
    const benMint = await guestMint(id, t, `&g=${KEY_B}`);
    expect(benMint.status).toBe(403);
    const benInfo = (await (await guestInfo(id, t, `&g=${KEY_B}`)).json()) as {
      admissionState: string;
    };
    expect(benInfo.admissionState).toBe('denied');
    expect((await guestMint(id, t, `&g=${KEY_A}`)).status).toBe(200);
  });

  it('an expired instant meeting refuses mints as closed', async () => {
    const meeting = await instant.createInstantMeeting(host, {
      settings: { instantLifetimeMinutes: 1 },
      now: new Date(Date.now() - 2 * 60 * 1000),
    });
    const id = String(meeting._id);
    const res = await guestMint(id, meeting.guestJoinToken!, `&g=${KEY_A}`);
    expect(res.status).toBe(410);
    expect(((await res.json()) as { code: string }).code).toBe('room_closed');
    const info = (await (await guestInfo(id, meeting.guestJoinToken!, `&g=${KEY_A}`)).json()) as {
      phase: string;
    };
    expect(info.phase).toBe('closed');
  });

  it('host mute and end work on an instant meeting through the booked endpoints', async () => {
    const meeting = await instant.createInstantMeeting(host, {});
    const id = String(meeting._id);
    const guestIdentity = `guest-${id}-${KEY_C}`;
    fakeParticipants.set(meeting.roomId!, [guestIdentity]);

    const mute = await hostCall(moderatePOST, id, { action: 'mute', identity: guestIdentity });
    expect(mute.status).toBe(200);
    expect(muteCalls.some((c) => c.includes(guestIdentity))).toBe(true);
    fakeParticipants.delete(meeting.roomId!);

    const end = await hostCall(moderatePOST, id, { action: 'end' });
    expect(end.status).toBe(200);
    const doc = await MeetBooking.findById(id);
    expect(doc?.roomStatus).toBe('closed');
    const after = await guestMint(id, meeting.guestJoinToken!, `&g=${KEY_C}`);
    expect(after.status).toBe(410);
  });

  it('the host can extend an instant meeting like a booked one', async () => {
    const meeting = await instant.createInstantMeeting(host, {});
    const id = String(meeting._id);
    const before = meeting.roomExpiresAt!.getTime();
    const res = await hostCall(extendPOST, id, {});
    expect(res.status).toBe(200);
    const data = (await res.json()) as { booking: { roomExpiresAt: string } };
    expect(new Date(data.booking.roomExpiresAt).getTime() - before).toBe(30 * 60 * 1000);
  });

  it('the recording routes work on an instant meeting', async () => {
    const meeting = await instant.createInstantMeeting(host, {});
    const id = String(meeting._id);

    const start = await hostCall(recordPOST, id, { action: 'start' });
    expect(start.status).toBe(200);
    expect(((await start.json()) as { recording: { status: string } }).recording.status).toBe(
      'recording',
    );
    const doc = await MeetBooking.findById(id);
    expect(doc?.recordingStatus).toBe('recording');
    expect(doc?.recordingEgressId).toBeTruthy();

    const state = await recordGET(
      new Request(`http://test.local/api/v0/bookings/${id}/record`, {
        headers: { cookie: `red_session=${hostJwt}` },
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(((await state.json()) as { recording: { status: string } }).recording.status).toBe(
      'recording',
    );

    const stop = await hostCall(recordPOST, id, { action: 'stop' });
    expect(stop.status).toBe(200);
    const after = await MeetBooking.findById(id);
    expect(after?.recordingStatus).toBe('processing');
  });

  it('a booked meeting still mints its one guest identity, no key involved', async () => {
    const type = await MeetType.create({
      hostId: host._id,
      slug: 'instant-suite-booked',
      name: 'Booked call',
      lengthMinutes: 30,
      active: true,
      sort: 9,
      entryMode: 'open',
    });
    const start = new Date(Date.now() - 60 * 1000);
    const booking = await MeetBooking.create({
      hostId: host._id,
      meetTypeId: type._id,
      guestName: 'Booked Guest',
      guestEmail: 'booked@example.com',
      start,
      end: new Date(start.getTime() + 30 * 60 * 1000),
      status: 'confirmed',
      calendarAttempts: 1,
    });
    await rooms.ensureBookingRoom(booking, type);
    const res = await guestMint(String(booking._id), booking.guestJoinToken!);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { identity: string };
    expect(data.identity).toBe(`guest-${String(booking._id)}`);
  });
});
