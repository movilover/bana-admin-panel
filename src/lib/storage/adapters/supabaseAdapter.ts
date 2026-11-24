import { WorkerBrokerStorageAdapter } from '@/src/lib/storage/adapters/workerBrokerAdapter';
import type { StorageProviderConfig } from '@/src/types/storage';

export const SUPABASE_FREE_MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB official Free Plan cap

export class SupabaseStorageAdapter extends WorkerBrokerStorageAdapter {
  constructor(config: StorageProviderConfig) {
    super({ ...config, providerId: 'supabase_storage' });
  }

  override async uploadObject(req: Parameters<WorkerBrokerStorageAdapter['uploadObject']>[0]) {
    if (req.file.size > SUPABASE_FREE_MAX_FILE_BYTES) {
      throw new Error(
        `File exceeds Supabase Free Plan 50 MB single-file upload limit (${Math.round(req.file.size / (1024 * 1024))} MB).`
      );
    }
    return super.uploadObject(req);
  }
}
