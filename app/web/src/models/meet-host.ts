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
 * lib/secrets.ts) and never serialised. Calendar calls run under it,
 * with `googleConnectionId` naming which of the host's own google
 * connections to act through; the gateway resolves that id against the
 * credential owner's connections only. A host with no credential has
 * no calendar: availability falls back to this app's own bookings and
 * says so.
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
  /**
   * The host's own redbtn gateway credential (a personal access token),
   * sealed with lib/secrets.ts under this host's AAD. Null until the
   * host connects their calendar in Settings.
   */
  gatewayCredential?: string | null;
  /**
   * Which of the host's own google connections calendar calls act
   * through. Only ever set to an id that google_accounts_list returned
   * under this host's own credential (enforced in the connect route).
   */
  googleConnectionId?: string | null;
  /** Email of the connected google account, for display in Settings. */
  googleConnectionEmail?: string | null;
  /** When the host connected their calendar. Null when not connected. */
  calendarConnectedAt?: Date | null;
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
    gatewayCredential: { type: String, default: null },
    googleConnectionId: { type: String, default: null },
    googleConnectionEmail: { type: String, default: null },
    calendarConnectedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const MeetHost: Model<MeetHostDoc> =
  models.MeetHost ?? model<MeetHostDoc>('MeetHost', meetHostSchema);
