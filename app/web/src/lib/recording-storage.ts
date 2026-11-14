import 'server-only';

import { GetObjectCommand, HeadBucketCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { getRecordingStorageConfig, type RecordingStorageConfig } from '@/lib/config';

/**
 * Reading recordings back (Epic 6, story 6.2.1).
 *
 * The write side is Egress itself (lib/recording.ts carries
 * the storage config in the start request). This module is
 * the read side: the same fleet S3 pattern Become's blob
 * store uses (@aws-sdk/client-s3 against the fleet MinIO,
 * path style), scoped to redMeet's own bucket. The only
 * caller is the host gated playback route; there is no
 * public URL for a recording, ever, so nothing here builds
 * one.
 */

let client: S3Client | null = null;
let clientKey = '';

function storageClient(config: RecordingStorageConfig): S3Client {
  const key = `${config.endpoint}|${config.bucket}|${config.accessKeyId}`;
  if (!client || key !== clientKey) {
    client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: config.forcePathStyle,
    });
    clientKey = key;
  }
  return client;
}

export interface RecordingObject {
  /** The file bytes as a web stream, ready to hand to a Response. */
  body: ReadableStream<Uint8Array>;
  contentType: string;
  /** Bytes in THIS response (the range length on a partial response). */
  contentLength: number | undefined;
  /** The full object size in bytes, when S3 reported it. */
  totalSize: number | undefined;
  contentRange: string | undefined;
  etag: string | undefined;
}

/**
 * Fetch a recording object, honoring an HTTP Range header
 * verbatim the way Become's blob store does: S3 answers 206
 * with Content-Range, and the route passes the status and
 * headers through, which is what makes in-browser playback
 * seekable.
 */
export async function getRecordingObject(
  storage: RecordingStorageConfig,
  key: string,
  range?: string,
): Promise<RecordingObject> {
  const res = await storageClient(storage).send(
    new GetObjectCommand({ Bucket: storage.bucket, Key: key, Range: range }),
  );
  if (!res.Body) throw new Error('Recording object had no body');
  return {
    body: res.Body.transformToWebStream(),
    contentType: res.ContentType ?? 'video/mp4',
    contentLength: res.ContentLength,
    totalSize: undefined,
    contentRange: res.ContentRange,
    etag: res.ETag,
  };
}

/** The object's size without fetching it, for the range bookkeeping fallback. */
export async function headRecordingObject(
  storage: RecordingStorageConfig,
  key: string,
): Promise<{ size: number | undefined; contentType: string | undefined }> {
  const res = await storageClient(storage).send(
    new HeadObjectCommand({ Bucket: storage.bucket, Key: key }),
  );
  return { size: res.ContentLength, contentType: res.ContentType };
}

/** Bucket reachability for the health check: configured AND answering. */
export async function checkRecordingBucket(
  storage: RecordingStorageConfig,
): Promise<{ ok: boolean; detail: string }> {
  try {
    await storageClient(storage).send(new HeadBucketCommand({ Bucket: storage.bucket }));
    return { ok: true, detail: 'bucket reachable' };
  } catch (error) {
    return { ok: false, detail: String(error).slice(0, 200) };
  }
}
