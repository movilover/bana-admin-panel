import type {
  ProviderQuotaCatalogItem,
  StorageObjectMetadata,
  StorageProviderConfig,
  StorageProviderId,
} from '@/src/types/storage';

const BLOCKED_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh', '.msi', '.dll', '.js', '.vbs', '.scr', '.apk'];

export function sanitizeObjectKey(rawKey: string): string {
  const normalized = String(rawKey || '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || /[\u0000-\u001f]/.test(normalized)) {
    throw new Error('Unsafe storage object key rejected.');
  }
  const safeSegments = normalized
    .split('/')
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .filter(Boolean);
  if (safeSegments.length === 0) {
    throw new Error('Object key cannot be empty.');
  }
  const joined = safeSegments.join('/');
  const lower = joined.toLowerCase();
  if (BLOCKED_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    throw new Error('Blocked executable file extension rejected.');
  }
  return joined;
}

export interface UploadObjectRequest {
  objectKey: string;
  file: Blob | File;
  mimeType: string;
  checksumSha256?: string;
  onProgress?: (pct: number) => void;
  abortSignal?: AbortSignal;
}

export interface ConnectionTestResult {
  ok: boolean;
  status: StorageProviderConfig['connectionStatus'];
  latencyMs: number;
  message: string;
  testedAtIso: string;
}

export interface HeadObjectResult {
  exists: boolean;
  sizeBytes?: number;
  mimeType?: string;
  etag?: string;
  acceptRanges?: boolean;
}

export interface ListedStorageObject {
  objectKey: string;
  sizeBytes: number;
  lastModifiedIso?: string;
  etag?: string;
}

export interface StorageAdapter {
  readonly providerId: StorageProviderId;
  readonly config: StorageProviderConfig;
  getProviderInfo(): ProviderQuotaCatalogItem;
  testConnection(): Promise<ConnectionTestResult>;
  uploadObject(req: UploadObjectRequest): Promise<StorageObjectMetadata>;
  downloadObject(objectKey: string): Promise<ArrayBuffer>;
  getPlaybackUrl(objectKey: string, publicUrlHint?: string): Promise<string>;
  headObject(objectKey: string): Promise<HeadObjectResult>;
  copyObjectFromUrl(params: {
    sourceUrl: string;
    targetObjectKey: string;
    expectedSha256?: string;
    mimeType?: string;
  }): Promise<{ ok: boolean; targetUrl: string; checksumSha256: string; sizeBytes: number }>;
  deleteObject(objectKey: string): Promise<void>;
  listObjects(prefix?: string, maxKeys?: number): Promise<ListedStorageObject[]>;
}
