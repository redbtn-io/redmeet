/**
 * Meeting behavior settings (Epic 5, George's ruling Nov 13,
 * 2026: limits should be a setting, everything should be a
 * setting).
 *
 * The numbers the earlier epics baked in as constants, how many
 * participants a room holds, how long before the start joins
 * open, how long after the end the room stays joinable, how far
 * a host extension pushes the close and how many extensions a
 * host gets, are meeting type settings now. A host edits them
 * next to the entry mode in Settings; every booking copies the
 * resolved values at booking time, exactly the way entryMode
 * has worked since Epic 4, so changing a type never moves a
 * meeting that is already booked.
 *
 * This module is the ONE config place for the defaults. The
 * meeting type fields and the booking fields are all optional;
 * anything unset resolves to the default here, so meeting types
 * and bookings written before these fields existed behave
 * exactly as they did when the numbers were constants.
 *
 * The deliberate exception, named rather than hidden: token TTL
 * is NOT a setting. How long a join credential lives is a
 * server side security property, it stays in lib/rooms.ts with
 * the other token rules, and no host surface can widen it.
 */

export interface MeetingSettings {
  /** Maximum participants in the room, host included. */
  participantLimit: number;
  /** Joins open this many minutes before the booking starts. */
  openLeadMinutes: number;
  /** The room stops accepting joins this many minutes after the booking ends. */
  closeLagMinutes: number;
  /** One host extension pushes the room close this many minutes later. */
  extensionMinutes: number;
  /** How many extensions the host may use on one booking. */
  extensionsAllowed: number;
  /**
   * Instant meetings (Epic 8): how long an instant meeting
   * stays open from the moment the host starts it. Instant
   * meetings have no meeting type to carry settings, so this
   * resolves from the defaults here and is stamped onto the
   * record at creation as its window (the host extension can
   * still push the close later, like any meeting).
   */
  instantLifetimeMinutes: number;
  /**
   * Auto record (Epic 9): a meeting with this on starts
   * recording on its own when the first participant's token
   * is minted inside the room window. A meeting type setting,
   * default off; bookings and instant meetings copy the
   * resolved value at creation, so changing a type never
   * changes a meeting that already exists.
   */
  recordAutomatically: boolean;
}

/** The defaults, today's behavior, in the one place they live. */
export const MEETING_SETTING_DEFAULTS: MeetingSettings = {
  participantLimit: 10,
  openLeadMinutes: 5,
  closeLagMinutes: 15,
  extensionMinutes: 30,
  extensionsAllowed: 1,
  instantLifetimeMinutes: 240,
  recordAutomatically: false,
};

/** Anything that can carry the settings fields: a meeting type or a booking. */
export type MeetingSettingsSource = Partial<MeetingSettings> | null | undefined;

function pickInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function pickBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickCount(value: unknown, fallback: number): number {
  // Zero is a real answer for some settings (joins open exactly
  // at the start, the room closes exactly at the end, a host
  // who never wants extensions), so those resolve separately
  // from the strictly positive numbers.
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

/**
 * Resolve the effective settings for a meeting type or a
 * booking: every field set on the source wins, every unset
 * field falls back to MEETING_SETTING_DEFAULTS.
 */
export function resolveMeetingSettings(source: MeetingSettingsSource): MeetingSettings {
  return {
    participantLimit: pickInt(source?.participantLimit, MEETING_SETTING_DEFAULTS.participantLimit),
    openLeadMinutes: pickCount(source?.openLeadMinutes, MEETING_SETTING_DEFAULTS.openLeadMinutes),
    closeLagMinutes: pickCount(source?.closeLagMinutes, MEETING_SETTING_DEFAULTS.closeLagMinutes),
    extensionMinutes: pickInt(source?.extensionMinutes, MEETING_SETTING_DEFAULTS.extensionMinutes),
    extensionsAllowed: pickCount(
      source?.extensionsAllowed,
      MEETING_SETTING_DEFAULTS.extensionsAllowed,
    ),
    instantLifetimeMinutes: pickInt(
      source?.instantLifetimeMinutes,
      MEETING_SETTING_DEFAULTS.instantLifetimeMinutes,
    ),
    recordAutomatically: pickBool(
      source?.recordAutomatically,
      MEETING_SETTING_DEFAULTS.recordAutomatically,
    ),
  };
}
