import { PROVIDER_QUOTA_CATALOG } from '@/src/lib/storage/providerCatalog';
import type {
  ConnectionTestResult,
  HeadObjectResult,
  ListedStorageObject,
  StorageAdapter,
  UploadObjectRequest,
} from '@/src/lib/storage/adapters/baseAdapter';
import type {
  ProviderQuotaCatalogItem,
  StorageObjectMetadata,
  StorageProviderConfig,
} from '@/src/types/storage';

/**
 * Optional Cloudflare Stream transcoding/HLS adapter.
 * Strictly disabled by default so zero paid billing activates on Spark Free mode.
 */
export class CloudflareStreamAdapter implements StorageAdapter {
  readonly providerId = 'cloudflare_stream' as const;
  readonly config: StorageProviderConfig;

  constructor(config: StorageProviderConfig) {
    this.config = config;
  }

  getProviderInfo(): ProviderQuotaCatalogItem {
    return PROVIDER_QUOTA_CATALOG.cloudflare_stream;
  }

  private assertBillingApproved() {
    if (!this.config.enabled || !this.config.billingApproved) {
      throw new Error(
        'Cloudflare Stream is disabled on Spark Free Plan mode. Approve billing & enable paid transcoding explicitly before use.'
      );
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      ok: false,
      status: this.config.enabled && this.config.billingApproved ? 'not_configured' : 'disabled',
      latencyMs: 0,
      message: 'Cloudflare Stream paid HLS transcoding is disabled to protect zero-cost Spark operation.',
      testedAtIso: new Date().toISOString(),
    };
  }

  async uploadObject(_req: UploadObjectRequest): Promise<StorageObjectMetadata> {
    this.assertBillingApproved();
    throw new Error('Cloudflare Stream direct upload endpoint requires Cloudflare Stream API activation.');
  }

  async downloadObject(): Promise<ArrayBuffer> {
    this.assertBillingApproved();
    throw new Error('Cloudflare Stream serves HLS manifests rather than raw object download.');
  }

  async getPlaybackUrl(_objectKey: string, publicUrlHint?: string): Promise<string> {
    this.assertBillingApproved();
    if (publicUrlHint) return publicUrlHint;
    throw new Error('Cloudflare Stream HLS manifest URL not available.');
  }

  async headObject(): Promise<HeadObjectResult> {
    return { exists: false };
  }

  async copyObjectFromUrl(): Promise<{ ok: boolean; targetUrl: string; checksumSha256: string; sizeBytes: number }> {
    this.assertBillingApproved();
    throw new Error('Cloudflare Stream copy is unavailable while disabled.');
  }

  async deleteObject(): Promise<void> {
    this.assertBillingApproved();
  }

  async listObjects(): Promise<ListedStorageObject[]> {
    return [];
  }
}
