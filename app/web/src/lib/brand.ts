import 'server-only';

/**
 * The app's brand module: module scope does the registration and NOTHING else.
 *
 * `configureBrand` reads no environment and performs no IO, which is what makes
 * it safe at module scope: `next build` evaluates this module with no runtime
 * env and no request. The two assertions that DO read env
 * (`assertDeploymentBrand`, `assertDeploymentAuth`) live in `getAuth()` in
 * `lib/session.ts`, behind the first request.
 *
 * `store: null`: redMeet has no brand-override store. The `BrandStore` port
 * exists so a future admin surface that edits a brand has somewhere to land
 * without a redLabel change; nothing writes one today.
 */
import { configureBrand } from '@redbtn/redlabel/server';
import { REGISTRY } from '@redbtn/redlabel/brands';

import { logger } from '@/lib/log';

configureBrand({
  registry: REGISTRY,
  store: null,
  // redLabel never decides who an admin is. Preview also needs REDLABEL_PREVIEW
  // to be '1', which it never is in production, so this stays false until the
  // platform admin surface exists to prove an actor.
  allowPreview: () => false,
  logger,
});

export { REGISTRY };
export { getBrand } from '@redbtn/redlabel/server';
