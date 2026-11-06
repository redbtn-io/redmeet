import { describe, expect, it } from 'vitest';

import { brandEmailBranding, brandEmailConfig } from './auth';
import { brandSchema, type Brand } from './brand';
import { medshield } from './brands/medshield';
import { redbtn } from './brands/redbtn';
import { redbtnBeta } from './brands/redbtn-beta';
import { exportIdentity, sarifToolDriver, stampCycloneDx } from './export';
import { brandNotifyIdentity } from './notify';
import { poweredBy } from './powered-by';
import { createRegistry } from './resolve';

/**
 * Section 10.6, the durable half: what a reseller's AUDITOR receives.
 *
 * A reseller whose in-app theming is perfect and whose evidence pack says
 * redScan has not been whitelabeled. These assertions are the sale.
 */

const REGISTRY = createRegistry({
  brands: [redbtn, redbtnBeta, medshield],
  defaultBrandId: 'redbtn',
});
const REDBTN = REGISTRY.brands['redbtn'] as Brand;
const MEDSHIELD = REGISTRY.brands['medshield'] as Brand;
const BETA = REGISTRY.brands['redbtn-beta'] as Brand;

describe('exportIdentity', () => {
  it('createRegistry fills what a brand file leaves out', () => {
    expect(exportIdentity(REDBTN)).toEqual({
      toolName: 'redScan',
      toolInformationUri: 'https://scan.redbtn.io',
      organization: 'redbtn',
      filenamePrefix: 'redscan',
      reportTitle: 'redScan',
      noticesUrl: 'https://scan.redbtn.io/legal/notices',
    });
  });

  it('a reseller artifact never names the wrong product', () => {
    const identity = exportIdentity(MEDSHIELD);
    expect(identity.toolName).toBe('MedShield Code Assurance');
    expect(identity.toolName).not.toContain('redScan');
    expect(identity.organization).toBe('MedShield');
    expect(identity.filenamePrefix).toBe('medshield');
    expect(identity.reportTitle).toBe('Code Assurance Evidence Pack');
  });

  it("licence notices resolve on the RESELLER's own origin", () => {
    // An absolute URL in an engine manifest would send a regulated customer's
    // auditor to a third party. The manifest carries a PATH and the app resolves
    // it against the resolved brand's origin.
    expect(exportIdentity(MEDSHIELD).noticesUrl).toBe('https://scan-demo.redbtn.io/legal/notices');
    expect(exportIdentity(BETA).noticesUrl).toBe('https://scan-beta.redbtn.io/legal/notices');
  });

  it('beta is its own environment, down to the filename', () => {
    expect(exportIdentity(BETA).filenamePrefix).toBe('redscan-beta');
    expect(exportIdentity(BETA).toolInformationUri).toBe('https://scan-beta.redbtn.io');
  });
});

describe('SARIF', () => {
  it("the driver is the brand's, and the version is the release's", () => {
    expect(sarifToolDriver(exportIdentity(MEDSHIELD), '0.1.0')).toEqual({
      name: 'MedShield Code Assurance',
      version: '0.1.0',
      informationUri: 'https://scan-demo.redbtn.io',
      organization: 'MedShield',
    });
  });
});

describe('CycloneDX', () => {
  /** A 1.6 document as the pinned Syft emits it: `metadata.tools` is an OBJECT. */
  const fixture = (): Record<string, unknown> => ({
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    metadata: {
      timestamp: '2026-09-21T00:00:00Z',
      tools: {
        components: [{ type: 'application', name: 'syft', version: '1.52.0', author: 'anchore' }],
        services: [],
      },
    },
    components: [],
  });

  it('APPENDS to metadata.tools.components and never replaces it', () => {
    const stamped = stampCycloneDx(fixture(), exportIdentity(MEDSHIELD), '0.1.0');
    const tools = (stamped['metadata'] as Record<string, unknown>)['tools'] as {
      components: Array<Record<string, unknown>>;
    };
    expect(tools.components).toHaveLength(2);
    // Syft stays under its OWN name and version: a document claiming MedShield
    // produced what Syft produced is a lie to an auditor.
    expect(tools.components[0]).toEqual({
      type: 'application',
      name: 'syft',
      version: '1.52.0',
      author: 'anchore',
    });
    expect(tools.components[1]).toEqual({
      type: 'application',
      name: 'MedShield Code Assurance',
      version: '0.1.0',
    });
  });

  it('sets the supplier from the brand', () => {
    const stamped = stampCycloneDx(fixture(), exportIdentity(MEDSHIELD), '0.1.0');
    expect((stamped['metadata'] as Record<string, unknown>)['supplier']).toEqual({
      name: 'MedShield',
      url: ['https://scan-demo.redbtn.io'],
    });
  });

  it('does not mutate the input', () => {
    const document = fixture();
    const before = JSON.stringify(document);
    stampCycloneDx(document, exportIdentity(REDBTN), '0.1.0');
    expect(JSON.stringify(document)).toBe(before);
  });

  it('a 1.4 array is appended to as an array, not overwritten at index 0', () => {
    // Writing metadata.tools[0] on a 1.4 document overwrites SYFT'S OWN ENTRY,
    // and on a 1.6 document that index is undefined.
    const legacy = { specVersion: '1.4', metadata: { tools: [{ name: 'syft', version: '1.52.0' }] } };
    const stamped = stampCycloneDx(legacy, exportIdentity(REDBTN), '0.1.0');
    const tools = (stamped['metadata'] as Record<string, unknown>)['tools'] as Array<Record<string, unknown>>;
    expect(tools).toHaveLength(2);
    expect(tools[0]).toEqual({ name: 'syft', version: '1.52.0' });
  });

  it('a document with no metadata at all still comes back stamped', () => {
    const stamped = stampCycloneDx({ specVersion: '1.6' }, exportIdentity(REDBTN), '0.1.0');
    const tools = (stamped['metadata'] as Record<string, unknown>)['tools'] as {
      components: unknown[];
      services: unknown[];
    };
    expect(tools.components).toHaveLength(1);
    expect(tools.services).toEqual([]);
  });
});

describe('brandEmailBranding', () => {
  it('footerText is a non-empty string for every brand in the registry', () => {
    for (const brand of Object.values(REGISTRY.brands)) {
      const branding = brandEmailBranding(brand);
      expect(branding.footerText, brand.id).toBeTypeOf('string');
      expect((branding.footerText ?? '').length, brand.id).toBeGreaterThan(0);
    }
  });

  it('synthesizes one when the brand leaves it out, so redauth never falls back to its own', () => {
    // redauth's template falls back to "(c) <year> RedBtn. All rights reserved."
    // when the field is absent, in the one email every single user receives
    // before they ever see the app.
    const brand = brandSchema.parse({
      ...medshield,
      email: { ...medshield.email, footerText: null },
    });
    const branding = brandEmailBranding(brand);
    expect(branding.footerText).toBe(`© ${new Date().getFullYear()} MedShield. All rights reserved.`);
    expect(branding.footerText).not.toContain('RedBtn');
  });

  it('no brand footer names RedBtn unless its own copyright holder does', () => {
    for (const brand of Object.values(REGISTRY.brands)) {
      const footer = brandEmailBranding(brand).footerText ?? '';
      if (!/redbtn/i.test(brand.legal.copyrightHolder ?? brand.legal.companyName)) {
        expect(footer, brand.id).not.toMatch(/RedBtn/);
      }
    }
  });

  it('the display name is appName, because redauth composes the From header itself', () => {
    expect(brandEmailBranding(MEDSHIELD).appName).toBe('MedShield');
    expect(brandEmailConfig(MEDSHIELD, { host: 'h', port: 587, user: 'u', pass: 'p' }).from).toBe(
      'scan@redbtn.io',
    );
  });
});

describe('brandNotifyIdentity, for the surfaces that execute outside the app', () => {
  const identity = brandNotifyIdentity(MEDSHIELD, REGISTRY);

  it('every value is derivable from the brand', () => {
    expect(identity.productName).toBe('MedShield Code Assurance');
    expect(identity.productShort).toBe('MedShield');
    expect(identity.supportEmail).toBe('support@redbtn.io');
  });

  it('accentHex is a literal, because there is no CSS in Slack', () => {
    expect(identity.accentHex).toMatch(/^#[0-9a-f]{6}$/);
    expect(identity.accentHex).toBe('#0ea5e9');
  });

  it('markUrl and originUrl are absolute and both start with the brand origin', () => {
    expect(identity.markUrl).toBe('https://scan-demo.redbtn.io/brand/medshield/icon-192.png');
    expect(identity.originUrl).toBe('https://scan-demo.redbtn.io');
    expect(identity.markUrl.startsWith(MEDSHIELD.origin)).toBe(true);
  });

  it('nothing names redScan except poweredByText, which says it by design', () => {
    for (const [key, value] of Object.entries(identity)) {
      if (key === 'poweredByText') continue;
      expect(String(value), key).not.toContain('redScan');
    }
    expect(identity.poweredByText).toBe('Powered by redScan');
  });

  it('a brand with no reseller carries an empty attribution', () => {
    expect(brandNotifyIdentity(REDBTN, REGISTRY).poweredByText).toBe('');
  });
});

describe('poweredBy', () => {
  it('a reseller names its parent and links to the parent origin', () => {
    expect(poweredBy(MEDSHIELD, REGISTRY)).toEqual({
      show: true,
      text: 'Powered by redScan',
      href: 'https://scan.redbtn.io',
    });
  });

  it('redbtn itself shows nothing', () => {
    expect(poweredBy(REDBTN, REGISTRY).show).toBe(false);
  });
});
