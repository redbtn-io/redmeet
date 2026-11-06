/**
 * The launcher's wordmark split, generalized to any brand.
 *
 * redbtn.io's own rule is `^red([A-Z][A-Za-z]*)$`, hardcoded. Hardcoding it here
 * would make redbtn's prefix the behaviour every adopter inherits, so the prefix
 * is a brand field (`product.wordmarkPrefix`) and `null` means "never split".
 * `null` is the DEFAULT; the redbtn brand file states `'red'` explicitly.
 */
export type WordmarkParts = { prefix: string; suffix: string } | { plain: string };

export function splitWordmark(name: string, prefix: string | null): WordmarkParts {
  if (prefix === null || prefix === '') return { plain: name };
  // Case sensitive, exactly like the launcher: `medShield` does not match a
  // `red` prefix, and a brand that states no prefix can never be split by
  // accident.
  const pattern = new RegExp(`^${prefix}([A-Z][A-Za-z]*)$`);
  const match = pattern.exec(name);
  if (!match) return { plain: name };
  return { prefix, suffix: (match[1] as string).toLowerCase() };
}
