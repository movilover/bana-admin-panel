import { WorkerBrokerStorageAdapter } from '@/src/lib/storage/adapters/workerBrokerAdapter';
import type { StorageProviderConfig } from '@/src/types/storage';

export class BackblazeB2Adapter extends WorkerBrokerStorageAdapter {
  constructor(config: StorageProviderConfig) {
    super({ ...config, providerId: 'backblaze_b2' });
  }
}
