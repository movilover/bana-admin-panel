import { WorkerBrokerStorageAdapter } from '@/src/lib/storage/adapters/workerBrokerAdapter';
import type { StorageProviderConfig } from '@/src/types/storage';

export class GoogleCloudStorageAdapter extends WorkerBrokerStorageAdapter {
  constructor(config: StorageProviderConfig) {
    super({ ...config, providerId: 'google_cloud_storage', requiresBilling: true });
  }
}
