/**
 * Pure provider configuration validation (Prompt 12).
 *
 * No Firebase / React imports on purpose: this module must stay runnable under plain Node
 * (tests/providers/provider-validation.test.mjs) so the paid-provider guards can be verified
 * without a browser build or network access.
 *
 * Validation never reads or writes secrets. It only inspects non-secret metadata.
 */
import type { StorageProviderConfig } from '@/src/types/storage';
import type { ApiProviderConfig } from '@/src/types/apiManagement';

export interface ProviderValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
const ICE_PROTOCOLS = new Set(['stun:', 'stuns:', 'turn:', 'turns:']);

/**
 * Returns an error message when an optional endpoint URL is malformed or insecure.
 * Empty values are allowed (the field is optional). Plain http:// is allowed only for localhost dev.
 */
export function validateEndpointUrl(raw: string | undefined | null, label: string): string | null {
  const value = String(raw || '').trim();
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `${label} is not a valid URL.`;
  }

  if (url.protocol === 'https:' || url.protocol === 'wss:') return null;
  // ICE server URIs (default calling provider uses stun:stun.l.google.com:19302). These are not HTTP
  // endpoints, so the https rule does not apply to them.
  if (ICE_PROTOCOLS.has(url.protocol)) return null;
  if ((url.protocol === 'http:' || url.protocol === 'ws:') && LOCAL_HOSTS.has(url.hostname)) return null;

  return `${label} must use https:// (or wss://). Plain http:// is allowed only for localhost.`;
}

/** Validates one storage provider config before it is written to Firestore. */
export function validateStorageProviderConfig(
  cfg: Pick<
    StorageProviderConfig,
    'label' | 'enabled' | 'requiresBilling' | 'billingApproved' | 'endpointUrl' | 'workerBrokerUrl' | 'publicCdnBaseUrl'
  >
): ProviderValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const endpointError = validateEndpointUrl(cfg.endpointUrl, 'Endpoint URL');
  if (endpointError) errors.push(endpointError);

  const brokerError = validateEndpointUrl(cfg.workerBrokerUrl, 'Media Broker URL');
  if (brokerError) errors.push(brokerError);

  const cdnError = validateEndpointUrl(cfg.publicCdnBaseUrl, 'Public CDN base URL');
  if (cdnError) errors.push(cdnError);

  // Paid providers must never be left enabled without an explicit billing approval.
  if (cfg.enabled && cfg.requiresBilling && !cfg.billingApproved) {
    errors.push(`${cfg.label} is a paid provider and cannot be enabled before billing approval.`);
  }

  if (cfg.enabled && !cfg.workerBrokerUrl && !cfg.endpointUrl) {
    warnings.push(`${cfg.label} is enabled but has no Media Broker or endpoint URL; uploads will be blocked until one is set.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Validates an API provider before it is activated.
 * Paid providers need the admin's billing approval; endpoint URLs must be secure.
 */
export function validateApiProviderConfig(
  item: Pick<ApiProviderConfig, 'name' | 'requiresBillingApproval' | 'billingApprovedByAdmin' | 'endpointUrl'>
): ProviderValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (item.requiresBillingApproval && !item.billingApprovedByAdmin) {
    errors.push(`Approve billing for ${item.name} before activating it. Paid providers stay inactive until approved.`);
  }

  const endpointError = validateEndpointUrl(item.endpointUrl, `${item.name} endpoint URL`);
  if (endpointError) errors.push(endpointError);

  return { ok: errors.length === 0, errors, warnings };
}
