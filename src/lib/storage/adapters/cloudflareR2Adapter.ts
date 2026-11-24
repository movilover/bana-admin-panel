import { WorkerBrokerStorageAdapter } from '@/src/lib/storage/adapters/workerBrokerAdapter';
import type { StorageProviderConfig } from '@/src/types/storage';

export class CloudflareR2Adapter extends WorkerBrokerStorageAdapter {
  constructor(config: StorageProviderConfig) {
    super({ ...config, providerId: 'cloudflare_r2' });
  }
}
