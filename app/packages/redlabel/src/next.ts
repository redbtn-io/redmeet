/**
 * v0 Next.js helpers shim. Canonical: redscan's packages/redlabel next module
 * (brandMetadata, brandFontLinks, brandViewport).
 */
import type { Metadata } from 'next';

export function brandMetadata(): Metadata {
  return {
    title: 'redMeet',
    description: 'Simple meeting scheduling. Share one link, guests book against your real calendar, no account needed.',
  };
}
