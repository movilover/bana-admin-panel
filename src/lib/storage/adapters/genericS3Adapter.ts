import { WorkerBrokerStorageAdapter } from '@/src/lib/storage/adapters/workerBrokerAdapter';
import type { StorageProviderConfig } from '@/src/types/storage';

export class GenericS3Adapter extends WorkerBrokerStorageAdapter {
  constructor(config: StorageProviderConfig) {
    super({ ...config, providerId: 'generic_s3' });
  }
}
