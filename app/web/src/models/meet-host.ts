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
 * `googleConnectionId` is the redbtn connection the calendar calls act
 * through. In v1 the app PAT is George's, so only his linked accounts
 * resolve; the field is the seam for per-host connections later.
 */
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
  /** Google calendar ids availability is read from. Default ['primary']. */
  calendarIds: string[];
  /** redbtn google connection id, when the host has linked one. */
  googleConnectionId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const meetHostSchema = new Schema<MeetHostDoc>(
  {
    ownerId: { type: String, required: true, unique: true, index: true },
    ownerEmail: { type: String, required: true },
    slug: { type: String, required: true, unique: true, index: true },
    displayName: { type: String, required: true },
    bio: { type: String, default: '' },
    color: { type: String, default: '#dc2626' },
    timeZone: { type: String, default: 'America/New_York' },
    calendarIds: { type: [String], default: ['primary'] },
    googleConnectionId: { type: String, default: null },
  },
  { timestamps: true },
);

export const MeetHost: Model<MeetHostDoc> =
  models.MeetHost ?? model<MeetHostDoc>('MeetHost', meetHostSchema);
