/**
 * The projection for surfaces that execute OUTSIDE the app.
 *
 * The Slack and Discord alerts are graph tool steps running inside the redbtn
 * hub, where redLabel is not installed, `org_settings` is not readable and the
 * graph is owned by a service account. Asserting "resolve through `brandForOrg`"
 * there supplies no mechanism and the copy silently falls back to whatever the
 * prompt hardcodes. So the app computes this flat JSON projection and puts it
 * into the graph run input at trigger time, beside the scan plan.
 *
 * **No graph prompt, template or notification body may contain a product name, a
 * URL or a colour literal.** Every such value arrives in this object and is
 * interpolated by the step.
 */
import type { Brand } from './brand';
import { poweredBy } from './powered-by';
import type { BrandRegistry } from './resolve';
import { resolveBrandColors } from './tokens';

export interface BrandNotifyIdentity {
  productName: string;
  productShort: string;
  /** A literal `#rrggbb`: there is no CSS out there. */
  accentHex: string;
  /** Absolute, resolved against the brand's origin. */
  markUrl: string;
  originUrl: string;
  /** Empty when `poweredBy().show` is false. */
  poweredByText: string;
  supportEmail: string;
}

export function brandNotifyIdentity(brand: Brand, registry: BrandRegistry): BrandNotifyIdentity {
  const colors = resolveBrandColors(brand, 'dark');
  const badge = poweredBy(brand, registry);
  return {
    productName: brand.product.name,
    productShort: brand.product.short,
    accentHex: colors['accent' as keyof typeof colors] as string,
    markUrl: new URL(brand.logo.markUrl, brand.origin).toString(),
    originUrl: brand.origin,
    poweredByText: badge.show ? badge.text : '',
    supportEmail: brand.support.email,
  };
}
