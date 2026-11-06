import 'server-only';

/**
 * The static registry: the one entry allowed to read `process.env`, and the one
 * that is SERVER AND BUILD ONLY.
 *
 * `import 'server-only'` is the enforcement, not a comment. A client component
 * that imported this would ship every brand's config (support email, install
 * URL, legal text, every reseller's colours) to every browser.
 *
 * `createRegistry` runs at MODULE LOAD, so a bad registry is a build failure and
 * never a runtime surprise.
 *
 * Ported from redscan's packages/redlabel (the estate canonical). The shipped
 * brand files (`redbtn`, `redbtnBeta`, `medshield`) are the package's reference
 * brands and test fixtures and are registered here unchanged; `redmeet` is
 * this deployment's own brand, added in `./redmeet`.
 */
import { createRegistry, type BrandRegistry } from '../resolve';
import { medshield } from './medshield';
import { redbtn } from './redbtn';
import { redbtnBeta } from './redbtn-beta';
import { redmeet } from './redmeet';

/**
 * The brand this deployment IS.
 *
 * The `?? 'redmeet'` fallback exists to let `next build` EVALUATE this module
 * and for nothing else: RedRun's runtime env does not exist at build time, so
 * a throw here would be a red Docker build rather than a caught
 * misconfiguration. An unset variable is caught at first request by
 * `assertDeploymentBrand`, and a typo is caught here by `createRegistry`,
 * which refuses a `defaultBrandId` that is not in the registry and names the
 * ids that are.
 */
export function deploymentBrandId(): string {
  return process.env['REDMEET_DEFAULT_BRAND_ID'] ?? 'redmeet';
}

export const REGISTRY: BrandRegistry = createRegistry({
  brands: [redmeet, redbtn, redbtnBeta, medshield],
  defaultBrandId: deploymentBrandId(),
});

export { medshield, redbtn, redbtnBeta, redmeet };
