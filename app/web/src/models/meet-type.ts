import 'server-only';
import { model, models, Schema, Types, type Model } from 'mongoose';

/**
 * MeetType, one bookable meeting kind on a host's page: the original
 * app's `userDetails.meetings[]` entries (`name`, `description`, `link`,
 * `length`). The public address is `/<host slug>/<type slug>`.
 */
/** Entry mode for a meeting type (Epic 4, feature 4.3). */
export type EntryMode = 'open' | 'waiting_room';

export interface MeetTypeDoc {
  _id: Types.ObjectId;
  hostId: Types.ObjectId;
  /** The `link` segment from the original: /<host>/<slug>. */
  slug: string;
  name: string;
  description: string;
  lengthMinutes: number;
  active: boolean;
  sort: number;
  /**
   * Room backend for bookings of this type (Epic 1). Only 'livekit'
   * exists today; the field is per type so an intro call and a paid
   * consult can use different room settings later. Bookings copy it
   * at booking time.
   */
  roomProvider: string;
  /**
   * Entry mode for bookings of this type (Epic 4, feature 4.3):
   * 'open' lets the guest enter as soon as the room opens,
   * 'waiting_room' holds them until the host admits them.
   * Bookings copy it at booking time, so changing it here only
   * affects future bookings.
   */
  entryMode: EntryMode;
  /**
   * Meeting behavior settings (Epic 5): the participant limit
   * and the room window numbers. All optional on purpose:
   * unset resolves to the defaults in lib/meeting-settings.ts
   * (10 participants, opens 5 minutes before, closes 15
   * minutes after, 30 minute extension, 1 extension), so a
   * meeting type written before these fields existed behaves
   * exactly as it did when the numbers were constants.
   * Bookings copy the resolved values at booking time.
   */
  participantLimit?: number;
  openLeadMinutes?: number;
  closeLagMinutes?: number;
  extensionMinutes?: number;
  extensionsAllowed?: number;
  createdAt: Date;
  updatedAt: Date;
}

const meetTypeSchema = new Schema<MeetTypeDoc>(
  {
    hostId: { type: Schema.Types.ObjectId, ref: 'MeetHost', required: true, index: true },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    description: { type: String, default: '' },
    lengthMinutes: { type: Number, required: true, default: 30 },
    active: { type: Boolean, default: true },
    sort: { type: Number, default: 0 },
    roomProvider: { type: String, default: 'livekit' },
    entryMode: { type: String, enum: ['open', 'waiting_room'], default: 'open' },
    participantLimit: Number,
    openLeadMinutes: Number,
    closeLagMinutes: Number,
    extensionMinutes: Number,
    extensionsAllowed: Number,
  },
  { timestamps: true },
);

meetTypeSchema.index({ hostId: 1, slug: 1 }, { unique: true });

export const MeetType: Model<MeetTypeDoc> =
  models.MeetType ?? model<MeetTypeDoc>('MeetType', meetTypeSchema);
