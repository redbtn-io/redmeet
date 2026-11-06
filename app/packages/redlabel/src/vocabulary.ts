/**
 * The rename map. Not i18n: no interpolation, no plural rules, no locale.
 *
 * A reseller in a regulated industry calls a scan an "assessment" and a finding
 * an "observation"; that is the whole requirement. Plurals are their own keys
 * because there is no pluralization engine, which is honest about what this is.
 *
 * The key set covers every noun a navigation label, a tab title or a settings
 * heading shows. Without `apiKeys`, `integrations`, `uploads` and `repositories`
 * a reseller renames scans to assessments and still reads "CI keys" and
 * "Integrations" on its own settings page.
 */
import type { Brand } from './brand';

export const VOCABULARY_KEYS = [
  'scan', 'scans', 'project', 'projects', 'finding', 'findings',
  'policy', 'policies', 'gate', 'report', 'reports', 'sbom',
  'dependency', 'dependencies', 'severity', 'vulnerability',
  'organization', 'organizations', 'member', 'members',
  'overview', 'settings',
  'apiKey', 'apiKeys', 'integration', 'integrations',
  'upload', 'uploads', 'repository', 'repositories',
] as const;
export type VocabularyKey = (typeof VOCABULARY_KEYS)[number];

export const DEFAULT_VOCABULARY: Readonly<Record<VocabularyKey, string>> = Object.freeze({
  scan: 'scan', scans: 'scans', project: 'project', projects: 'projects',
  finding: 'finding', findings: 'findings', policy: 'policy', policies: 'policies',
  gate: 'gate', report: 'report', reports: 'reports', sbom: 'SBOM',
  dependency: 'dependency', dependencies: 'dependencies',
  severity: 'severity', vulnerability: 'vulnerability',
  organization: 'organization', organizations: 'organizations',
  member: 'member', members: 'members',
  overview: 'overview', settings: 'settings',
  apiKey: 'CI key', apiKeys: 'CI keys',
  integration: 'integration', integrations: 'integrations',
  upload: 'upload', uploads: 'uploads',
  repository: 'repository', repositories: 'repositories',
});

/**
 * Fallback chain: the brand's override, then the default. There is no third
 * step, because `VocabularyKey` is a closed union: an unknown key is a
 * typecheck error rather than a raw key string leaking into the UI.
 */
export function t(brand: Brand, key: VocabularyKey): string {
  return brand.product.vocabulary[key] ?? DEFAULT_VOCABULARY[key];
}

/** The pre-bound form, so a component writes `t('finding')`. */
export function vocabulary(brand: Brand): (key: VocabularyKey) => string {
  return (key) => t(brand, key);
}

/** Uppercase the first letter only when the string is not already all caps, so `SBOM` survives. */
export function titleCase(value: string): string {
  if (value.length === 0) return value;
  if (value === value.toUpperCase()) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
