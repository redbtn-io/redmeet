import 'server-only';
import { model, models, Schema, Types, type Model } from 'mongoose';

/**
 * MeetHost, one redbtn user's public booking identity.
 *
 * Created lazily on first sign-in (see lib/hosts.ts): the slug is the
 * public address (`meet.redbtn.io/<slug>`), the colour and bio dress the
 * public booking page exactly as the original 2025 app dressed it (host
 * colour as `--primary-color`, a highlight derived from it).
 *
 * Calendar tenancy is PER HOST: `gatewayCredential` is the host's OWN
 * redbtn personal access token, sealed at rest (AES-256-GCM, see
 * lib/secrets.ts) and never serialised. Calendar calls run under it.
 * The gateway resolves connection ids against the credential owner's
 * connections only.
 *
 * Calendar SCOPE is a set of (connection, calendar) pairs,
 * `calendarSelection`, spanning ANY of the host's linked google
 * accounts: availability merges free/busy across every ticked pair,
 * and booking events are written to the single `calendarWriteTarget`
 * pair. A connection is one linked google account, so a host who
 * lives on several accounts (the normal case) ticks calendars across
 * all of them. The older single-connection fields (`calendarIds`,
 * `googleConnectionId`) are legacy: they describe the pre-expansion
 * shape, are converted forward into a selection on first resolve
 * (lib/calendar-auth.ts), and are kept only as a mirror for older
 * readers. A host with no credential has no calendar: availability
 * falls back to this app's own bookings and says so.
 */
/** One ticked calendar: a calendar on one of the host's connections. */
export interface CalendarSelectionEntryDoc {
  connectionId: string;
  calendarId: string;
  /** Account email the calendar lives under, for grouped display. */
  email: string;
  /** Calendar summary at the time it was listed. */
  summary: string;
}

/** The single (connection, calendar) pair booking events write to. */
export interface CalendarWriteTargetDoc {
  connectionId: string;
  calendarId: string;
}

/** One day's booking window, "HH:mm" wall times in the host's zone. */
export interface DayWindowDoc {
  start: string;
  end: string;
}

/**
 * The host's own booking hours: a weekday window and a weekend
 * window. Set in Settings; the defaults are the original 2025 app's
 * hardcoded hours, so a host who never touches them sees no change.
 * The shape mirrors @redmeet/core's AvailabilityWindows.
 */
export interface AvailabilityWindowsDoc {
  weekday: DayWindowDoc;
  weekend: DayWindowDoc;
}

export interface MeetHostDoc {
  _id: Types.ObjectId;
  /** redauth userId of the owner. */
  ownerId: string;
  ownerEmail: string;
  /** Public slug, unique, validated by @redmeet/core isValidSlug. */
  slug: string;
  displayName: string;
  bio: string;
  /** Hex colour, e.g. #dc2626. */
  color: string;
  timeZone: string;
  /**
   * The host's booking hours (weekday and weekend windows). Absent on
   * records written before the field existed; readers normalise
   * through @redmeet/core's defaults.
   */
  availabilityWindows?: AvailabilityWindowsDoc | null;
  /**
   * LEGACY: google calendar ids on the single legacy connection that
   * availability was read from. Superseded by `calendarSelection`;
   * kept as a flat mirror of the selection's calendar ids.
   */
  calendarIds: string[];
  /**
   * The calendars that block slots, as (connection, calendar) pairs
   * across ANY of the host's linked google accounts. Empty until the
   * host connects and picks (or a migration builds it from the legacy
   * fields).
   */
  calendarSelection: CalendarSelectionEntryDoc[];
  /** Where confirmed booking events are written. One of the pairs. */
  calendarWriteTarget?: CalendarWriteTargetDoc | null;
  /**
   * The host's own redbtn gateway credential (a personal access token),
   * sealed with lib/secrets.ts under this host's AAD. Null until the
   * host connects their calendar in Settings.
   */
  gatewayCredential?: string | null;
  /**
   * LEGACY: the host's default google connection, the account picked
   * in the connect flow. Only ever set to an id that
   * google_accounts_list returned under this host's own credential
   * (enforced in the connect route). The full set of the host's usable
   * connections is `googleConnectionIds`.
   */
  googleConnectionId?: string | null;
  /** Email of the default google connection, for display in Settings. */
  googleConnectionEmail?: string | null;
  /**
   * Every google connection id linked under the host's credential, as
   * returned by google_accounts_list under that same credential at
   * connect (or migration) time. Selections may only name ids in a
   * fresh listing under the credential; this stored set is the
   * snapshot the picker renders from before re-listing.
   */
  googleConnectionIds: string[];
  /** When the host connected their calendar. Null when not connected. */
  calendarConnectedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const calendarSelectionEntrySchema = new Schema<CalendarSelectionEntryDoc>(
  {
    connectionId: { type: String, required: true },
    calendarId: { type: String, required: true },
    email: { type: String, default: '' },
    summary: { type: String, default: '' },
  },
  { _id: false },
);

const calendarWriteTargetSchema = new Schema<CalendarWriteTargetDoc>(
  {
    connectionId: { type: String, required: true },
    calendarId: { type: String, required: true },
  },
  { _id: false },
);

const dayWindowSchema = new Schema<DayWindowDoc>(
  {
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
  { _id: false },
);

const availabilityWindowsSchema = new Schema<AvailabilityWindowsDoc>(
  {
    weekday: { type: dayWindowSchema, required: true },
    weekend: { type: dayWindowSchema, required: true },
  },
  { _id: false },
);

const meetHostSchema = new Schema<MeetHostDoc>(
  {
    ownerId: { type: String, required: true, unique: true, index: true },
    ownerEmail: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true },
    bio: { type: String, default: '' },
    color: { type: String, default: '#dc2626' },
    timeZone: { type: String, default: 'America/New_York' },
    availabilityWindows: {
      type: availabilityWindowsSchema,
      default: () => ({
        weekday: { start: '10:00', end: '20:00' },
        weekend: { start: '10:00', end: '14:00' },
      }),
    },
    calendarIds: { type: [String], default: ['primary'] },
    calendarSelection: { type: [calendarSelectionEntrySchema], default: [] },
    calendarWriteTarget: { type: calendarWriteTargetSchema, default: null },
    gatewayCredential: { type: String, default: null },
    googleConnectionId: { type: String, default: null },
    googleConnectionEmail: { type: String, default: null },
    googleConnectionIds: { type: [String], default: [] },
    calendarConnectedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const MeetHost: Model<MeetHostDoc> =
  models.MeetHost ?? model<MeetHostDoc>('MeetHost', meetHostSchema);
