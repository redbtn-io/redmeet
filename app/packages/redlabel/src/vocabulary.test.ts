import { describe, expect, expectTypeOf, it } from 'vitest';

import { brandSchema, type Brand } from './brand';
import { medshield } from './brands/medshield';
import { redbtn } from './brands/redbtn';
import { FEATURE_KEYS, feature } from './features';
import { DEFAULT_VOCABULARY, VOCABULARY_KEYS, t, titleCase, vocabulary } from './vocabulary';
import { splitWordmark } from './wordmark';

/** Section 10.4. The rename map, the feature map and the wordmark split. */

const REDBTN: Brand = brandSchema.parse(redbtn);
const MEDSHIELD: Brand = brandSchema.parse(medshield);

describe('t()', () => {
  it('a brand with no vocabulary returns every default', () => {
    for (const key of VOCABULARY_KEYS) {
      expect(t(REDBTN, key)).toBe(DEFAULT_VOCABULARY[key]);
    }
  });

  it('a brand with a partial vocabulary returns its overrides and the defaults for the rest', () => {
    expect(t(MEDSHIELD, 'scan')).toBe('assessment');
    expect(t(MEDSHIELD, 'scans')).toBe('assessments');
    expect(t(MEDSHIELD, 'finding')).toBe('observation');
    expect(t(MEDSHIELD, 'sbom')).toBe('CBOM');
    expect(t(MEDSHIELD, 'project')).toBe('product');
    // Untouched keys keep the default, which is what makes the map partial.
    expect(t(MEDSHIELD, 'severity')).toBe('severity');
    expect(t(MEDSHIELD, 'apiKey')).toBe('CI key');
  });

  it('both halves of a plural are renamed, because there is no pluralization engine', () => {
    expect(t(MEDSHIELD, 'report')).toBe('evidence pack');
    expect(t(MEDSHIELD, 'reports')).toBe('evidence packs');
  });

  it('DEFAULT_VOCABULARY has exactly VOCABULARY_KEYS as its keys, both directions', () => {
    expect(Object.keys(DEFAULT_VOCABULARY).sort()).toEqual([...VOCABULARY_KEYS].sort());
    for (const key of VOCABULARY_KEYS) expect(DEFAULT_VOCABULARY[key]).toBeTypeOf('string');
  });

  it('the pre-bound form is the same function', () => {
    const bound = vocabulary(MEDSHIELD);
    for (const key of VOCABULARY_KEYS) expect(bound(key)).toBe(t(MEDSHIELD, key));
  });

  it('an unknown key does not compile', () => {
    expectTypeOf(t).parameter(1).not.toEqualTypeOf<string>();
    // @ts-expect-error 'nope' is not a VocabularyKey, which is the closed union
    // that removes the need for a third fallback step.
    expect(() => t(REDBTN, 'nope')).not.toThrow();
  });
});

describe('titleCase', () => {
  it("uppercases the first letter only when the string is not already all caps, so SBOM survives", () => {
    expect(titleCase('sbom')).toBe('Sbom');
    expect(titleCase('SBOM')).toBe('SBOM');
    expect(titleCase('scan')).toBe('Scan');
    expect(titleCase('CBOM')).toBe('CBOM');
    expect(titleCase('evidence pack')).toBe('Evidence pack');
    expect(titleCase('')).toBe('');
  });
});

describe('the CI key label is composed, never a literal', () => {
  it('reads "redScan CI key" on the default brand and "MedShield CI key" on a reseller', () => {
    expect(`${REDBTN.product.short} ${t(REDBTN, 'apiKey')}`).toBe('redScan CI key');
    expect(`${MEDSHIELD.product.short} ${t(MEDSHIELD, 'apiKey')}`).toBe('MedShield CI key');
  });
});

describe('feature()', () => {
  it('reads the brand', () => {
    expect(feature(REDBTN, 'aiFix')).toBe(true);
    expect(feature(MEDSHIELD, 'aiFix')).toBe(false);
    expect(feature(MEDSHIELD, 'aiTriage')).toBe(true);
    expect(feature(REDBTN, 'billing')).toBe(false);
  });

  it('every shipped brand states a position on every feature, so adding one forces a revisit', () => {
    for (const brand of [REDBTN, MEDSHIELD]) {
      for (const key of FEATURE_KEYS) {
        expect(typeof brand.features[key], `${brand.id}.${key}`).toBe('boolean');
      }
    }
  });

  it('returns false for a brand missing a key, which the schema makes impossible', () => {
    const broken = { ...REDBTN, features: {} } as unknown as Brand;
    for (const key of FEATURE_KEYS) expect(feature(broken, key)).toBe(false);
  });
});

describe('splitWordmark', () => {
  it('splits on the brand-stated prefix', () => {
    expect(splitWordmark('redScan', 'red')).toEqual({ prefix: 'red', suffix: 'scan' });
  });

  it('a brand that states no prefix can never be split by accident', () => {
    expect(splitWordmark('redScan', null)).toEqual({ plain: 'redScan' });
    expect(splitWordmark('MedShield Code Assurance', null)).toEqual({ plain: 'MedShield Code Assurance' });
    expect(splitWordmark('medShield', null)).toEqual({ plain: 'medShield' });
  });

  it('the match is case sensitive, exactly like the launcher', () => {
    expect(splitWordmark('Redscan', 'red')).toEqual({ plain: 'Redscan' });
    expect(splitWordmark('redscan', 'red')).toEqual({ plain: 'redscan' });
    expect(splitWordmark('red', 'red')).toEqual({ plain: 'red' });
  });

  it('the shipped brands take the paths their files state', () => {
    expect(splitWordmark(REDBTN.product.short, REDBTN.product.wordmarkPrefix)).toEqual({
      prefix: 'red',
      suffix: 'scan',
    });
    expect(splitWordmark(MEDSHIELD.product.short, MEDSHIELD.product.wordmarkPrefix)).toEqual({
      plain: 'MedShield',
    });
  });
});
