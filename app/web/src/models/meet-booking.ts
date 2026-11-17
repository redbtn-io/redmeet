import 'server-only';
import { model, models, Schema, Types, type Model } from 'mongoose';

import type { EntryMode } from '@/models/meet-type';

/**
 * MeetBooking, one guest's booking through a public link.
 *
 * A booking is written `pending_calendar` first, then the calendar event
 * is created through the gateway; success flips it to `confirmed` with
 * the event id, failure leaves `calendar_failed` with the error kept.
 * The guest only ever sees a confirmation when the status is
 * `confirmed` (or an honest "booked, calendar invite pending" state:
 * never a fake event id).
 *
 * Slot integrity (Epic 0): a PARTIAL UNIQUE index on (hostId, start)
 * covers the live statuses (pending_calendar, confirmed,
 * calendar_failed), so MongoDB itself rejects a second live booking
 * for the same host and start. A cancelled booking falls out of the
 * index, which is what frees its slot. createBooking claims the slot
 * with an upsert keyed on that index (see lib/bookings.ts), so two
 * concurrent requests for the same slot cannot both pass.
 */
export type BookingStatus =
  | 'pending_calendar'
  | 'confirmed'
  | 'calendar_failed'
  | 'cancelled'
  | 'instant';

/**
 * Which kind of meeting a record is (Epic 8). `booked` is the
 * original shape: one guest books a slot through a public link
 * and a calendar invite goes out. `instant` is a meeting the
 * host spins up on demand: no slot, no calendar event, no named
 * guest, and the guest link is a share link that admits many
 * guests at once. The status carries `instant` too, which is
 * what keeps instant records out of the slot index, the
 * availability math, and the calendar reconciliation sweep:
 * none of those key off anything but the slot holding statuses.
 */
export type MeetingKind = 'booked' | 'instant';

/**
 * Room lifecycle (Epic 1). `not_created` is stamped with the room
 * fields at booking time (the room record exists from the start, so
 * the join link is stable); `live` once the room is inside its open
 * window and a token has been minted; `closed` after expiry, host
 * end, or cancellation.
 */
export type RoomStatus = 'not_created' | 'live' | 'closed';

/**
 * Waiting room admission (Epic 4, feature 4.3). `none` is a
 * guest who has not asked yet; `waiting` is an ask the host has
 * not decided; `admitted` and `denied` are the host's decisions.
 */
export type GuestAdmissionState = 'none' | 'waiting' | 'admitted' | 'denied';

/**
 * Recording state (Epic 6), one recording per booking.
 * `idle` is a meeting that was never recorded (or has not
 * started recording yet); `recording` is a live Egress job;
 * `processing` is a stopped job whose file is still being
 * written and uploaded; `ready` means the file is stored
 * against the booking with its duration and size; `failed`
 * means Egress reported a failure or the job vanished, with
 * the reason kept in recordingError. A recording is only ever
 * `ready` when Egress itself reported completion with a file
 * result.
 */
export type RecordingStatus = 'idle' | 'recording' | 'processing' | 'ready' | 'failed';

/** Statuses that hold their slot against new bookings. */
export const SLOT_HOLDING_STATUSES: BookingStatus[] = [
  'pending_calendar',
  'confirmed',
  'calendar_failed',
];

/**
 * One guest's waiting room admission on an INSTANT meeting
 * (Epic 8). A booked meeting has exactly one guest, so its
 * admission lives in the flat guestAdmission fields below. An
 * instant meeting's share link admits many guests, each with
 * their own identity, so admission is per guest: one entry per
 * guest identity that has asked. Only meaningful when the
 * record kind is 'instant' and entryMode is 'waiting_room'.
 */
export interface GuestAdmissionEntry {
  /** The guest's LiveKit identity, guest-<bookingId>-<guestKey>. */
  identity: string;
  /** The name the guest asked to join under (their lobby name). */
  name: string;
  state: GuestAdmissionState;
  requestedAt?: Date;
  decidedAt?: Date;
}

export interface MeetBookingDoc {
  _id: Types.ObjectId;
  hostId: Types.ObjectId;
  /**
   * Booked or instant (Epic 8). Records written before the
   * field existed have no kind and are booked meetings.
   */
  kind?: MeetingKind;
  /** The meeting type the booking came from. Instant meetings have none. */
  meetTypeId?: Types.ObjectId;
  /** Host given title for an instant meeting. Booked meetings take the type's name. */
  title?: string;
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  comments: string;
  start: Date;
  end: Date;
  status: BookingStatus;
  /** Google calendar id the event was written to. */
  calendarId?: string;
  /** Google event id, set only when the write succeeded. */
  calendarEventId?: string;
  calendarError?: string;
  /** How many times a calendar write has been attempted for this booking. */
  calendarAttempts: number;
  /** When the most recent calendar write was attempted. */
  lastCalendarAttemptAt?: Date;
  /** Random token written by the atomic slot claim; see lib/bookings.ts. */
  claimToken?: string;
  /**
   * Video room fields (Epic 1), stamped at booking time by
   * lib/rooms.ts. The room belongs to the booking, one room per
   * booking, never shared. The join tokens are random per booking;
   * the Mongo _id is NEVER used as a token (it is already returned
   * in booking responses and is guessable in structure).
   */
  /** LiveKit room name, unique per booking. */
  roomId?: string;
  /** The guest-facing join URL for this booking's room. */
  roomUrl?: string;
  /** Secret in the guest's join link; checked before a guest token is minted. */
  guestJoinToken?: string;
  /** Secret for the host's link-based join path (Epic 2). The dashboard path in this epic is the session. */
  hostJoinToken?: string;
  /** Room backend for this booking, copied from the meeting type. */
  roomProvider: string;
  roomStatus: RoomStatus;
  /** When the room fields were stamped (booking time). */
  roomCreatedAt?: Date;
  /** When the room stops accepting joins; end plus the close lag setting, pushed later by host extensions. */
  roomExpiresAt?: Date;
  /** True once the host has used their one room extension. */
  roomExtended: boolean;
  /**
   * Meeting behavior settings copied from the meeting type at
   * booking time (Epic 5), resolved through
   * lib/meeting-settings.ts so unset means the defaults (10
   * participants, opens 5 minutes before, closes 15 minutes
   * after, 30 minute extension, 1 extension). Bookings written
   * before these fields existed carry none of them and resolve
   * to the same defaults.
   */
  participantLimit?: number;
  openLeadMinutes?: number;
  closeLagMinutes?: number;
  extensionMinutes?: number;
  extensionsAllowed?: number;
  /** How many extensions the host has used on this booking (Epic 5). */
  roomExtensionsUsed: number;
  /** Entry mode copied from the meeting type at booking time (Epic 4, feature 4.3). */
  entryMode: EntryMode;
  /**
   * Waiting room admission for this booking's guest (Epic 4,
   * feature 4.3). Only meaningful when entryMode is
   * 'waiting_room'. The guest mint refuses until the state is
   * 'admitted', so no publishing token exists before admission.
   */
  guestAdmissionState: GuestAdmissionState;
  /** The name the guest asked to join under (their lobby name). */
  guestAdmissionName: string;
  guestAdmissionRequestedAt?: Date;
  guestAdmissionDecidedAt?: Date;
  /** Per guest admission entries, instant meetings only (Epic 8). */
  guestAdmissions: GuestAdmissionEntry[];
  /**
   * LiveKit identities the host removed from this booking's
   * room (Epic 4, feature 4.2). The mint checks this list,
   * which is what tells a REMOVED guest apart from a DROPPED
   * one: a drop leaves no record and the same link mints
   * again; a removal is recorded here and the same link is
   * refused for good.
   */
  removedIdentities: string[];
  /** When the host ended the meeting (Epic 4, feature 4.2). */
  roomEndedAt?: Date;
  /**
   * Recording fields (Epic 6). The recording belongs to the
   * booking, like the room. The object key is the only storage
   * reference stored; the bucket and endpoint are deployment
   * config, and the file itself is only ever served through
   * the host gated playback route, never a public URL.
   */
  /**
   * Auto record (Epic 9): copied from the meeting type at
   * booking time (instant meetings: the host's choice at
   * creation). Default off; records written before the field
   * existed read as off. When on, the first token mint inside
   * the room window starts the recording on its own through
   * lib/recording.ts maybeAutoStartRecording.
   */
  recordAutomatically: boolean;
  /** When the auto start claim was taken (Epic 9). Set only
   *  while an auto start is in flight or has succeeded; a
   *  failed attempt clears it so a later mint can retry. */
  recordingAutoClaimedAt?: Date;
  /** When the host stopped an auto started recording (Epic
   *  9). Once set, auto record never restarts for this
   *  booking: the host's stop is the final word. */
  recordingAutoStoppedByHostAt?: Date;
  recordingStatus: RecordingStatus;
  /** The LiveKit Egress job id for this booking's recording. */
  recordingEgressId?: string;
  recordingStartedAt?: Date;
  recordingStoppedAt?: Date;
  /** Object key of the finished MP4 in the recording bucket. */
  recordingKey?: string;
  /** Duration of the finished file in seconds, from Egress's own file result. */
  recordingDurationSeconds?: number;
  /** Size of the finished file in bytes, from Egress's own file result. */
  recordingSizeBytes?: number;
  /** Why the recording failed, in words a host can act on. Set only when failed. */
  recordingError?: string;
  /** When the host cancelled the booking. */
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const meetBookingSchema = new Schema<MeetBookingDoc>(
  {
    hostId: { type: Schema.Types.ObjectId, ref: 'MeetHost', required: true, index: true },
    kind: { type: String, enum: ['booked', 'instant'], default: 'booked', index: true },
    // A meeting type id is required for booked meetings by the
    // booking flow itself; instant meetings (Epic 8) have none,
    // so the schema cannot demand one. Same for the guest name
    // and email: a booked guest always supplies both through the
    // validated booking form, an instant meeting has no guest
    // until someone opens the share link.
    meetTypeId: { type: Schema.Types.ObjectId, ref: 'MeetType', index: true },
    title: { type: String, default: '' },
    guestName: { type: String, default: '' },
    guestEmail: { type: String, default: '' },
    guestPhone: { type: String, default: '' },
    comments: { type: String, default: '' },
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending_calendar', 'confirmed', 'calendar_failed', 'cancelled', 'instant'],
      required: true,
      default: 'pending_calendar',
    },
    calendarId: String,
    calendarEventId: String,
    calendarError: String,
    calendarAttempts: { type: Number, default: 0 },
    lastCalendarAttemptAt: Date,
    claimToken: String,
    roomId: { type: String, index: true },
    roomUrl: String,
    guestJoinToken: String,
    hostJoinToken: String,
    roomProvider: { type: String, default: 'livekit' },
    roomStatus: {
      type: String,
      enum: ['not_created', 'live', 'closed'],
      required: true,
      default: 'not_created',
    },
    roomCreatedAt: Date,
    roomExpiresAt: Date,
    roomExtended: { type: Boolean, default: false },
    participantLimit: Number,
    openLeadMinutes: Number,
    closeLagMinutes: Number,
    extensionMinutes: Number,
    extensionsAllowed: Number,
    roomExtensionsUsed: { type: Number, default: 0 },
    entryMode: { type: String, enum: ['open', 'waiting_room'], default: 'open' },
    guestAdmissionState: {
      type: String,
      enum: ['none', 'waiting', 'admitted', 'denied'],
      default: 'none',
    },
    guestAdmissionName: { type: String, default: '' },
    guestAdmissionRequestedAt: Date,
    guestAdmissionDecidedAt: Date,
    guestAdmissions: {
      type: [
        new Schema<GuestAdmissionEntry>(
          {
            identity: { type: String, required: true },
            name: { type: String, default: '' },
            state: {
              type: String,
              enum: ['none', 'waiting', 'admitted', 'denied'],
              default: 'none',
            },
            requestedAt: Date,
            decidedAt: Date,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    removedIdentities: { type: [String], default: [] },
    roomEndedAt: Date,
    recordAutomatically: { type: Boolean, default: false },
    recordingAutoClaimedAt: Date,
    recordingAutoStoppedByHostAt: Date,
    recordingStatus: {
      type: String,
      enum: ['idle', 'recording', 'processing', 'ready', 'failed'],
      required: true,
      default: 'idle',
    },
    recordingEgressId: String,
    recordingStartedAt: Date,
    recordingStoppedAt: Date,
    recordingKey: String,
    recordingDurationSeconds: Number,
    recordingSizeBytes: Number,
    recordingError: String,
    cancelledAt: Date,
  },
  { timestamps: true },
);

meetBookingSchema.index(
  { hostId: 1, start: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: SLOT_HOLDING_STATUSES } },
  },
);
// The reconciliation sweep scans by status and age.
meetBookingSchema.index({ status: 1, updatedAt: 1 });
// The recording sweep (Epic 6) scans by recording status.
meetBookingSchema.index({ recordingStatus: 1, updatedAt: 1 });

export const MeetBooking: Model<MeetBookingDoc> =
  models.MeetBooking ?? model<MeetBookingDoc>('MeetBooking', meetBookingSchema);
