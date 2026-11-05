/**
 * v0 theme shim. Canonical: redscan's packages/redlabel theme module
 * (BrandThemeScript, ThemeStyle, brandStyleProps).
 * v0 renders without the brand system; this keeps the import shape stable
 * so adopting it later is mechanical.
 */
export function brandStyleProps(): Record<string, string> {
  return {};
}
