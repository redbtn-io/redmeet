import 'server-only';
import { model, models, Schema, Types, type Model } from 'mongoose';

/**
 * MeetType, one bookable meeting kind on a host's page: the original
 * app's `userDetails.meetings[]` entries (`name`, `description`, `link`,
 * `length`). The public address is `/<host slug>/<type slug>`.
 */
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
  },
  { timestamps: true },
);

meetTypeSchema.index({ hostId: 1, slug: 1 }, { unique: true });

export const MeetType: Model<MeetTypeDoc> =
  models.MeetType ?? model<MeetTypeDoc>('MeetType', meetTypeSchema);
