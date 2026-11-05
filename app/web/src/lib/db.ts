import 'server-only';
import mongoose from 'mongoose';

import { getConfig } from '@/lib/config';
import { logger } from '@/lib/log';

/**
 * Mongoose singleton. One connection per container, established lazily on
 * first use — never at module load (see config.ts: build-time imports must
 * not touch the network).
 */
let connecting: Promise<typeof mongoose> | null = null;

export function getDb(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose);
  if (!connecting) {
    const { mongoUri } = getConfig();
    if (!mongoUri) return Promise.reject(new Error('MONGODB_URI is not configured'));
    connecting = mongoose
      .connect(mongoUri, { maxPoolSize: 10 })
      .catch((error: unknown) => {
        connecting = null;
        logger.error('mongodb connect failed', { error: String(error) });
        throw error;
      });
  }
  return connecting;
}
