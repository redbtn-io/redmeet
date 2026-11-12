/**
 * Slot claim tests (Epic 0, story 0.1.4).
 *
 * Integration tests: they need a real MongoDB, because the thing
 * under test IS MongoDB's atomicity (the partial unique index plus
 * the upsert claim). Set TEST_MONGODB_URI to a throwaway database
 * (for example a local docker mongo) to run them; without it the
 * suite skips rather than failing.
 *
 * The seeded host has NO connected calendar, so bookings land in
 * pending_calendar and no gateway call is ever made.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const TEST_URI = process.env.TEST_MONGODB_URI;

describe.skipIf(!TEST_URI)('atomic slot claim', () => {
  let mongoose: typeof import('mongoose').default;
  let bookings: typeof import('@/lib/bookings');
  let MeetHost: typeof import('@/models/meet-host').MeetHost;
  let MeetType: typeof import('@/models/meet-type').MeetType;
  let MeetBooking: typeof import('@/models/meet-booking').MeetBooking;

  let host: import('mongoose').HydratedDocument<import('@/models/meet-host').MeetHostDoc>;
  let type: import('@/models/meet-type').MeetTypeDoc;
  let date: string;
  let label: string;

  beforeAll(async () => {
    process.env.MONGODB_URI = TEST_URI!;
    mongoose = (await import('mongoose')).default;
    await mongoose.connect(TEST_URI!);
    await mongoose.connection.dropDatabase();
    bookings = await import('@/lib/bookings');
    ({ MeetHost } = await import('@/models/meet-host'));
    ({ MeetType } = await import('@/models/meet-type'));
    ({ MeetBooking } = await import('@/models/meet-booking'));
    await MeetBooking.createIndexes();

    host = await MeetHost.create({
      ownerId: 'test-owner-1',
      ownerEmail: 'host@example.com',
      slug: 'testhost',
      displayName: 'Test Host',
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

    // A weekday at least 4 days out, so every slot clears the
    // same-day lead time rule in any timezone the test runs in.
    const day = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000);
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    date = day.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const { slots } = await bookings.availabilityFor(host, type, date);
    expect(slots.length).toBeGreaterThan(0);
    label = slots[0]!.label;
  }, 30000);

  afterAll(async () => {
    await mongoose?.disconnect();
  });

  const input = (name: string) => ({
    date,
    time: label,
    name,
    email: `${name.toLowerCase().replace(/\s/g, '.')}@example.com`,
    phone: '',
    comments: '',
  });

  it('lets exactly one of two concurrent bookings for the same slot through', async () => {
    const results = await Promise.allSettled([
      bookings.createBooking(host, type, input('Guest One')),
      bookings.createBooking(host, type, input('Guest Two')),
    ]);
    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      bookings.BookingConflictError,
    );
    const count = await MeetBooking.countDocuments({ hostId: host._id });
    expect(count).toBe(1);
  }, 30000);

  it('holds the slot for a calendar_failed booking', async () => {
    const { slots } = await bookings.availabilityFor(host, type, date);
    const target = slots[0]!;
    await MeetBooking.create({
      hostId: host._id,
      meetTypeId: type._id,
      guestName: 'Failed Guest',
      guestEmail: 'failed@example.com',
      start: new Date(target.startMs),
      end: new Date(target.endMs),
      status: 'calendar_failed',
      calendarError: 'gateway exploded',
      calendarAttempts: 1,
    });
    const after = await bookings.availabilityFor(host, type, date);
    expect(after.slots.map((s) => s.startMs)).not.toContain(target.startMs);
    await expect(
      bookings.createBooking(host, type, { ...input('Guest Three'), time: target.label }),
    ).rejects.toBeInstanceOf(bookings.BookingConflictError);
  }, 30000);

  it('frees the slot again when the host cancels', async () => {
    // Its own day, so no other test's bookings (or their buffer
    // slots) interfere with the availability answer.
    const day = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);
    while (day.getDay() === 0 || day.getDay() === 6) day.setDate(day.getDate() + 1);
    const date2 = day.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const { slots } = await bookings.availabilityFor(host, type, date2);
    const target = slots[0]!;
    const booking = await bookings.createBooking(host, type, {
      date: date2,
      time: target.label,
      name: 'Guest Four',
      email: 'guest.four@example.com',
      phone: '',
      comments: '',
    });
    expect(booking.status).toBe('pending_calendar');

    const { calendarRemoved } = await bookings.cancelBooking(host, booking);
    expect(calendarRemoved).toBeNull();
    const reloaded = await MeetBooking.findById(booking._id);
    expect(reloaded?.status).toBe('cancelled');

    const after = await bookings.availabilityFor(host, type, date2);
    expect(after.slots.map((s) => s.startMs)).toContain(target.startMs);
    const again = await bookings.createBooking(host, type, {
      date: date2,
      time: target.label,
      name: 'Guest Five',
      email: 'guest.five@example.com',
      phone: '',
      comments: '',
    });
    expect(again.status).toBe('pending_calendar');
  }, 30000);
});
