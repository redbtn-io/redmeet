/**
 * Calendar write path tests (Epic 0, features 0.2 and 0.3 host side).
 *
 * Integration tests against a real MongoDB (TEST_MONGODB_URI, skips
 * without it) and a STUB MCP gateway: a local HTTP server speaking
 * just enough of the gateway's JSON-RPC to answer freebusy, insert,
 * and delete. The stub's insert can be flipped between success and
 * failure, which is what lets these tests prove the failure path:
 * a failed write holds the slot, a retry lands the invite, the
 * reconciliation sweep rescues a stale failure, and host cancel
 * deletes the event.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URI = process.env.TEST_MONGODB_URI;

describe.skipIf(!TEST_URI)('calendar write, retry, reconcile, cancel', () => {
  let mongoose: typeof import('mongoose').default;
  let bookings: typeof import('@/lib/bookings');
  let reconcile: typeof import('@/lib/reconcile');
  let MeetHost: typeof import('@/models/meet-host').MeetHost;
  let MeetType: typeof import('@/models/meet-type').MeetType;
  let MeetBooking: typeof import('@/models/meet-booking').MeetBooking;

  let host: import('mongoose').HydratedDocument<import('@/models/meet-host').MeetHostDoc>;
  let type: import('@/models/meet-type').MeetTypeDoc;
  let date: string;

  let server: Server;
  let insertFails = false;
  let insertCount = 0;
  const insertArgs: Array<Record<string, unknown>> = [];
  const deletedEvents: Array<{ calendarId: string; eventId: string }> = [];

  function startStubGateway(): Promise<string> {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        let msg: { id?: number; method?: string; params?: { name?: string; arguments?: Record<string, string> } };
        try {
          msg = JSON.parse(body);
        } catch {
          res.writeHead(400).end();
          return;
        }
        if (msg.method === 'notifications/initialized') {
          res.writeHead(202).end();
          return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('mcp-session-id', 'stub-session');
        if (msg.method === 'initialize') {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: msg.id,
              result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'stub', version: '0' } },
            }),
          );
          return;
        }
        if (msg.method === 'tools/call') {
          const tool = msg.params?.name;
          const reply = (payload: unknown, isError = false) =>
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: msg.id,
                result: { isError, content: [{ type: 'text', text: JSON.stringify(payload) }] },
              }),
            );
          if (tool === 'gcal_freebusy_query') return reply({ calendars: {} });
          if (tool === 'gcal_events_insert') {
            insertCount += 1;
            insertArgs.push((msg.params?.arguments ?? {}) as Record<string, unknown>);
            if (insertFails) return reply({ message: 'stub insert failure' }, true);
            return reply({ id: `evt-${insertCount}` });
          }
          if (tool === 'gcal_events_delete') {
            deletedEvents.push({
              calendarId: String(msg.params?.arguments?.calendarId ?? ''),
              eventId: String(msg.params?.arguments?.eventId ?? ''),
            });
            return reply({});
          }
          return reply({ message: `unknown tool ${tool}` }, true);
        }
        res.writeHead(404).end();
      });
    });
    return new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        resolve(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`);
      });
    });
  }

  beforeAll(async () => {
    process.env.MONGODB_URI = TEST_URI!;
    process.env.REDMEET_ENCRYPTION_KEY = 'ab'.repeat(32);
    // Vitest defines BASE_URL as "/" (the Vite built-in), which
    // would make room URLs relative. Pin the origin the calendar
    // payload assertions expect.
    process.env.BASE_URL = 'https://meet.redbtn.io';
    const gatewayUrl = await startStubGateway();
    process.env.MCP_GATEWAY_URL = gatewayUrl;
    const { resetConfig } = await import('@/lib/config');
    resetConfig();

    mongoose = (await import('mongoose')).default;
    await mongoose.connect(TEST_URI!);
    await mongoose.connection.dropDatabase();
    bookings = await import('@/lib/bookings');
    reconcile = await import('@/lib/reconcile');
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    const { sealSecret, credentialAad } = await import('@/lib/secrets');
    host = await MeetHost.create({
      ownerId: 'test-owner-2',
      ownerEmail: 'host2@example.com',
      slug: 'calhost',
      displayName: 'Calendar Host',
      timeZone: 'America/New_York',
    });
    host.gatewayCredential = sealSecret('fake-host-token', credentialAad(String(host._id)));
    host.calendarSelection = [
      { connectionId: 'conn-1', calendarId: 'cal-1', email: 'host2@example.com', summary: 'Main' },
    ];
    host.calendarWriteTarget = { connectionId: 'conn-1', calendarId: 'cal-1' };
    host.googleConnectionId = 'conn-1';
    await host.save();

    type = await MeetType.create({
      hostId: host._id,
      slug: 'intro',
      name: 'Intro call',
      lengthMinutes: 30,
      active: true,
      sort: 0,
    });

    const day = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    date = day.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }, 30000);

  afterAll(async () => {
    await mongoose?.disconnect();
    server?.close();
  });

  async function firstFreeLabel(): Promise<string> {
    const { slots } = await bookings.availabilityFor(host, type, date);
    expect(slots.length).toBeGreaterThan(0);
    return slots[0]!.label;
  }

  const inputFor = (label: string, name: string) => ({
    date,
    time: label,
    name,
    email: `${name.toLowerCase().replace(/\s/g, '.')}@example.com`,
    phone: '',
    comments: '',
  });

  it('confirms the booking when the calendar write lands', async () => {
    insertFails = false;
    const label = await firstFreeLabel();
    const booking = await bookings.createBooking(host, type, inputFor(label, 'Happy Guest'));
    expect(booking.status).toBe('confirmed');
    expect(booking.calendarEventId).toMatch(/^evt-/);
    expect(booking.calendarAttempts).toBe(1);
  }, 30000);

  it('carries the guest join link in the calendar event (Epic 2, feature 2.3)', async () => {
    insertFails = false;
    const label = await firstFreeLabel();
    const booking = await bookings.createBooking(host, type, inputFor(label, 'Linked Guest'));
    expect(booking.status).toBe('confirmed');
    expect(booking.guestJoinToken).toBeTruthy();

    // BASE_URL is pinned to the production origin in beforeAll.
    const expected = `https://meet.redbtn.io/join/${String(booking._id)}?t=${booking.guestJoinToken}`;
    const args = insertArgs[insertArgs.length - 1]!;
    // Location is the link itself, not the old hardcoded 'Virtual'.
    expect(args.location).toBe(expected);
    // The description carries a Join line, so the link survives
    // in the invite email body even if a client hides location.
    expect(String(args.description)).toContain(`Join: ${expected}`);
    // And the link is stored on the event's private properties.
    const priv = (
      args.extendedProperties as { private: Record<string, string> }
    ).private;
    expect(priv.joinUrl).toBe(expected);
    expect(priv.bookedVia).toBe('redmeet');
    // The HOST join token never reaches the calendar payload.
    expect(JSON.stringify(args)).not.toContain(booking.hostJoinToken);
  }, 30000);

  it('holds the slot on failure and lands the invite on manual retry', async () => {
    insertFails = true;
    const label = await firstFreeLabel();
    const booking = await bookings.createBooking(host, type, inputFor(label, 'Unlucky Guest'));
    expect(booking.status).toBe('calendar_failed');
    expect(booking.calendarAttempts).toBe(1);

    // The failed booking still blocks its slot.
    await expect(
      bookings.createBooking(host, type, inputFor(label, 'Second Guest')),
    ).rejects.toBeInstanceOf(bookings.BookingConflictError);

    insertFails = false;
    const retried = await bookings.retryBookingCalendar(host, booking);
    expect(retried.status).toBe('confirmed');
    expect(retried.calendarEventId).toMatch(/^evt-/);
    expect(retried.calendarAttempts).toBe(2);
  }, 30000);

  it('reconciliation rescues a stale failed booking and respects the attempt cap', async () => {
    insertFails = true;
    const label = await firstFreeLabel();
    const booking = await bookings.createBooking(host, type, inputFor(label, 'Stale Guest'));
    expect(booking.status).toBe('calendar_failed');
    // Age it past the sweep's 15 minute threshold.
    await MeetBooking.collection.updateOne(
      { _id: booking._id },
      { $set: { updatedAt: new Date(Date.now() - 20 * 60 * 1000) } },
    );
    insertFails = false;
    await reconcile.reconcileFailedBookings();
    const rescued = await MeetBooking.findById(booking._id);
    expect(rescued?.status).toBe('confirmed');

    // A booking at the attempt cap is left alone by the sweep.
    insertFails = true;
    const label2 = await firstFreeLabel();
    const capped = await bookings.createBooking(host, type, inputFor(label2, 'Capped Guest'));
    await MeetBooking.collection.updateOne(
      { _id: capped._id },
      {
        $set: {
          calendarAttempts: bookings.MAX_AUTO_CALENDAR_ATTEMPTS,
          updatedAt: new Date(Date.now() - 20 * 60 * 1000),
        },
      },
    );
    insertFails = false;
    const insertsBefore = insertCount;
    await reconcile.reconcileFailedBookings();
    const after = await MeetBooking.findById(capped._id);
    expect(after?.status).toBe('calendar_failed');
    expect(insertCount).toBe(insertsBefore);
  }, 30000);

  it('host cancel deletes the calendar event and frees the slot', async () => {
    insertFails = false;
    const label = await firstFreeLabel();
    const booking = await bookings.createBooking(host, type, inputFor(label, 'Leaving Guest'));
    expect(booking.status).toBe('confirmed');
    const eventId = booking.calendarEventId!;

    const { calendarRemoved } = await bookings.cancelBooking(host, booking);
    expect(calendarRemoved).toBe(true);
    expect(deletedEvents).toContainEqual({ calendarId: 'cal-1', eventId });
    const reloaded = await MeetBooking.findById(booking._id);
    expect(reloaded?.status).toBe('cancelled');

    const rebooked = await bookings.createBooking(host, type, inputFor(label, 'New Guest'));
    expect(rebooked.status).toBe('confirmed');
  }, 30000);
});
