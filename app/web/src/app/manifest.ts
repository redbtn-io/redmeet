import type { MetadataRoute } from 'next';

import { brandManifest } from '@redbtn/redlabel/next';

import { getBrand } from '@/lib/brand';

/**
 * The installable-app manifest, per brand, from the request host.
 *
 * Three lines, on purpose: every decision (which icons, which sizes, which
 * colours, `maskable` on the padded copy only) lives in `brandManifest`,
 * and the SIZES come from `brand-icons.lock.json` rather than from a
 * literal, which is how a manifest stops declaring a 1024px file as
 * 512x512.
 */
export const dynamic = 'force-dynamic';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  return brandManifest(await getBrand());
}
