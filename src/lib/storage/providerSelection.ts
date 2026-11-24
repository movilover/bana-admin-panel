import type { StorageProviderConfig } from '@/src/types/storage';

/**
 * Picks the primary and backup storage providers (Prompt 12 safety fix).
 *
 * Paid providers (requiresBilling = true) are eligible ONLY when billingApproved = true.
 * The previous fallback (`all[0]`) could silently select an unapproved paid provider;
 * this selection never does.
 *
 * Pure function (no Firebase imports) so it can be tested under plain Node.
 */
export function selectPrimaryAndBackup(all: StorageProviderConfig[]): {
  primary: StorageProviderConfig;
  backup: StorageProviderConfig | null;
  all: StorageProviderConfig[];
} {
  const eligible = all.filter((p) => !p.requiresBilling || p.billingApproved);

  const primary =
    eligible.find((p) => p.role === 'primary' && p.enabled) ||
    eligible.find((p) => p.providerId === 'cloudflare_r2') ||
    eligible[0];

  if (!primary) {
    throw new Error(
      'No free or billing-approved storage provider is configured. Enable a free provider in Admin -> Storage & Recovery.'
    );
  }

  const backup =
    eligible.find(
      (p) =>
        p.role === 'secondary_backup' &&
        p.enabled &&
        p.providerId !== primary.providerId
    ) || null;

  return { primary, backup, all };
}
