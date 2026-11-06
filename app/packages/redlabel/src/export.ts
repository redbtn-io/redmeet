/**
 * The identity a durable artifact carries.
 *
 * The artifacts are the product: SARIF, CycloneDX, PDF reports and evidence
 * packs are first-class outputs and each of them names a tool. A reseller whose
 * in-app theming is perfect and whose evidence pack says redScan has not been
 * whitelabeled.
 *
 * **Engine identities are never rewritten.** Opengrep, OSV-Scanner, Gitleaks and
 * Syft stay in SARIF's `tool.extensions` and in CycloneDX's
 * `metadata.tools.components` under the names and versions they emitted, because
 * a SARIF that claims a reseller found a finding Opengrep found is a lie to an
 * auditor. The brand names the product that ASSEMBLED the document; the engines
 * name themselves.
 *
 * The brand an export is stamped with is the ORG's brand, not the request
 * host's: an export is durable, and a reseller's customer must never receive a
 * redbtn-stamped artifact because they happened to download it from a shared
 * host.
 */
import type { Brand } from './brand';

export interface ExportIdentity {
  toolName: string;
  toolInformationUri: string;
  organization: string;
  filenamePrefix: string;
  reportTitle: string;
  /** Absolute, for the export that carries it. Never a URL from an engine manifest. */
  noticesUrl: string;
}

export function exportIdentity(brand: Brand): ExportIdentity {
  const toolName = brand.export.toolName ?? brand.product.name;
  return {
    toolName,
    toolInformationUri: brand.export.toolInformationUri ?? brand.origin,
    organization: brand.export.organization ?? brand.legal.companyName,
    filenamePrefix: brand.export.filenamePrefix,
    reportTitle: brand.export.reportTitle ?? toolName,
    noticesUrl: new URL(brand.legal.noticesPath, brand.origin).toString(),
  };
}

/** SARIF `runs[].tool.driver`, the four fields `sarifToolComponentSchema` carries. */
export interface SarifToolDriver {
  name: string;
  version: string;
  informationUri: string;
  organization: string;
}

/**
 * The driver of every SARIF document this product writes or re-emits.
 *
 * The brand names the product that ASSEMBLED the document. Opengrep,
 * OSV-Scanner, Gitleaks and Syft stay in `tool.extensions` under the names and
 * versions they emitted, because a SARIF claiming a reseller found what Opengrep
 * found is a lie to an auditor and defeats the point of shipping evidence.
 */
export function sarifToolDriver(identity: ExportIdentity, version: string): SarifToolDriver {
  return {
    name: identity.toolName,
    version,
    informationUri: identity.toolInformationUri,
    organization: identity.organization,
  };
}

/**
 * Stamp a CycloneDX document's `metadata`, precisely, because the target depends
 * on the spec version and the naive one does not exist.
 *
 * **From CycloneDX 1.5 onward `metadata.tools` is an OBJECT**
 * `{components: [], services: []}`, not the array it was through 1.4, and the
 * pipeline pins Syft emitting 1.6. So:
 *
 * - APPEND to `metadata.tools.components`. Never write `metadata.tools[0]`: on
 *   the pinned engine that index is `undefined`, so the write is a crash or a
 *   silent no-op, and on a 1.4 document it is SYFT'S OWN ENTRY, so overwriting it
 *   does exactly what the paragraph above forbids.
 * - `metadata.tools` is never replaced, only appended to.
 * - `metadata.supplier` takes the brand's organization and its information URI.
 *
 * This lives in redLabel rather than in the app because it is the same rule for
 * every consumer, and a paragraph in a spec has never stopped anyone writing
 * `metadata.tools = [ours]`. It is pure and takes a plain object, so it needs no
 * CycloneDX types and no dependency: a shallow copy comes back, and the input is
 * not mutated.
 */
export function stampCycloneDx(
  document: Record<string, unknown>,
  identity: ExportIdentity,
  version: string,
): Record<string, unknown> {
  const metadata = { ...((document['metadata'] as Record<string, unknown> | undefined) ?? {}) };
  const tools = metadata['tools'];

  // A 1.4 document has an ARRAY here. Normalizing it to the 1.5 object shape is
  // not this function's job (that would rewrite the document's spec version), so
  // an array is appended to as an array and everything else becomes the object.
  if (Array.isArray(tools)) {
    metadata['tools'] = [...tools, { name: identity.toolName, version }];
  } else {
    const object = { ...((tools as Record<string, unknown> | undefined) ?? {}) };
    const components = Array.isArray(object['components']) ? [...(object['components'] as unknown[])] : [];
    components.push({ type: 'application', name: identity.toolName, version });
    object['components'] = components;
    if (!Array.isArray(object['services'])) object['services'] = [];
    metadata['tools'] = object;
  }

  metadata['supplier'] = {
    ...((metadata['supplier'] as Record<string, unknown> | undefined) ?? {}),
    name: identity.organization,
    url: [identity.toolInformationUri],
  };

  return { ...document, metadata };
}
