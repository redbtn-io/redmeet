/**
 * "Powered by <parent>", which is a contract decision and not a styling one.
 *
 * Pure and taking a `Brand`, so the non-React surfaces use it directly: the PDF
 * cover, the report footer and the email footer call
 * `poweredBy(brandForOrg(REGISTRY, orgSettings.brandId), REGISTRY)` with no
 * request and no context.
 */
import type { Brand } from './brand';
import type { BrandRegistry } from './resolve';

export interface PoweredByResult {
  show: boolean;
  text: string;
  href: string;
}

export function poweredBy(brand: Brand, registry: BrandRegistry): PoweredByResult {
  const reseller = brand.reseller;
  if (reseller === null || !reseller.poweredBy) return { show: false, text: '', href: '' };
  const parent = registry.brands[reseller.parentBrandId];
  if (parent === undefined) return { show: false, text: '', href: '' };
  return { show: true, text: `Powered by ${parent.product.name}`, href: parent.origin };
}
