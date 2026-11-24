import { getAuth } from 'firebase/auth';
import { computeBlobSha256, computeBufferSha256 } from '@/src/lib/storage/checksum';
import { PROVIDER_QUOTA_CATALOG } from '@/src/lib/storage/providerCatalog';
import {
  sanitizeObjectKey,
  type ConnectionTestResult,
  type HeadObjectResult,
  type ListedStorageObject,
  type StorageAdapter,
  type UploadObjectRequest,
} from '@/src/lib/storage/adapters/baseAdapter';
import type {
  ProviderQuotaCatalogItem,
  StorageObjectMetadata,
  StorageProviderConfig,
  StorageProviderId,
} from '@/src/types/storage';

async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return {};
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

export function resolveBrokerBaseUrl(config: StorageProviderConfig): string {
  const fromConfig = String(config.workerBrokerUrl || '').trim().replace(/\/+$/, '');
  if (fromConfig) return fromConfig;
  const fromEnv = String(import.meta.env.VITE_MEDIA_BROKER_URL || '').trim().replace(/\/+$/, '');
  return fromEnv;
}

function uploadViaXhr(
  uploadUrl: string,
  file: Blob | File,
  mimeType: string,
  onProgress?: (pct: number) => void,
  abortSignal?: AbortSignal
): Promise<{ etag?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.setRequestHeader('Content-Type', mimeType || 'application/octet-stream');

    if (abortSignal) {
      if (abortSignal.aborted) {
        reject(new Error('Upload aborted by user.'));
        return;
      }
      abortSignal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0 && onProgress) {
        onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        const etag = xhr.getResponseHeader('ETag')?.replace(/"/g, '') || undefined;
        resolve({ etag });
      } else {
        reject(new Error(`Object storage upload failed with HTTP ${xhr.status}: ${xhr.statusText || 'Error'}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during direct object storage upload.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file);
  });
}

/**
 * Unified Worker-Brokered Multi-Cloud Object Adapter for Spark-safe presigned PUT/GET/HEAD/COPY/DELETE.
 * Also supports direct S3 HTTP endpoints when explicitly tested in local/self-hosted integration environments.
 */
export class WorkerBrokerStorageAdapter implements StorageAdapter {
  readonly providerId: StorageProviderId;
  readonly config: StorageProviderConfig;

  constructor(config: StorageProviderConfig) {
    this.providerId = config.providerId;
    this.config = config;
  }

  getProviderInfo(): ProviderQuotaCatalogItem {
    return PROVIDER_QUOTA_CATALOG[this.providerId];
  }

  private assertConfigured(): string {
    if (!this.config.enabled) {
      throw new Error(`${this.config.label} is disabled in Storage Provider settings.`);
    }
    if (this.config.requiresBilling && !this.config.billingApproved) {
      throw new Error(
        `${this.config.label} requires billing approval. Spark-only mode blocks paid providers unless explicitly approved.`
      );
    }
    const broker = resolveBrokerBaseUrl(this.config);
    if (!broker) {
      throw new Error(
        `${this.config.label} is not configured: set VITE_MEDIA_BROKER_URL or configure a Media Broker endpoint first.`
      );
    }
    return broker;
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const started = Date.now();
    const testedAtIso = new Date().toISOString();

    if (!this.config.enabled) {
      return {
        ok: false,
        status: 'disabled',
        latencyMs: 0,
        message: 'Provider is currently disabled.',
        testedAtIso,
      };
    }

    if (this.config.requiresBilling && !this.config.billingApproved) {
      return {
        ok: false,
        status: 'disabled',
        latencyMs: 0,
        message: 'Blocked on Spark Free Plan: requires explicit billing approval before activation.',
        testedAtIso,
      };
    }

    const broker = resolveBrokerBaseUrl(this.config);
    if (!broker) {
      return {
        ok: false,
        status: 'not_configured',
        latencyMs: 0,
        message: 'Not configured: deploy Cloudflare Worker Media Broker & set VITE_MEDIA_BROKER_URL or Worker URL.',
        testedAtIso,
      };
    }

    try {
      const headers = await getAuthHeader();
      const resp = await fetch(`${broker}/api/media/probe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify({
          providerId: this.providerId,
          bucketName: this.config.bucketName || '',
          endpointUrl: this.config.endpointUrl || '',
          region: this.config.region || 'auto',
          publicCdnBaseUrl: this.config.publicCdnBaseUrl || '',
        }),
      });
      const data = (await resp.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
      };
      const latencyMs = Date.now() - started;

      if (!resp.ok || !data.ok) {
        return {
          ok: false,
          status: 'error',
          latencyMs,
          message: data.error || data.message || `Probe failed with HTTP ${resp.status}`,
          testedAtIso,
        };
      }

      return {
        ok: true,
        status: 'connected',
        latencyMs,
        message: data.message || `Live upload + download probe passed (${latencyMs}ms).`,
        testedAtIso,
      };
    } catch (err: any) {
      return {
        ok: false,
        status: 'error',
        latencyMs: Date.now() - started,
        message: err?.message || 'Unable to reach Worker Media Broker.',
        testedAtIso,
      };
    }
  }

  async uploadObject(req: UploadObjectRequest): Promise<StorageObjectMetadata> {
    const broker = this.assertConfigured();
    const safeKey = sanitizeObjectKey(req.objectKey);
    const checksumSha256 = req.checksumSha256 || (await computeBlobSha256(req.file));
    const headers = await getAuthHeader();

    const presignResp = await fetch(`${broker}/api/media/presign-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({
        providerId: this.providerId,
        objectKey: safeKey,
        contentType: req.mimeType,
        sizeBytes: req.file.size,
        checksumSha256,
        bucketName: this.config.bucketName || '',
        endpointUrl: this.config.endpointUrl || '',
        region: this.config.region || 'auto',
        publicCdnBaseUrl: this.config.publicCdnBaseUrl || '',
      }),
    });

    const presignData = (await presignResp.json().catch(() => ({}))) as {
      ok?: boolean;
      uploadUrl?: string;
      publicUrl?: string;
      error?: string;
    };

    if (!presignResp.ok || !presignData.uploadUrl || !presignData.publicUrl) {
      throw new Error(presignData.error || `Failed to obtain presigned upload URL (${presignResp.status}).`);
    }

    const { etag } = await uploadViaXhr(
      presignData.uploadUrl,
      req.file,
      req.mimeType,
      req.onProgress,
      req.abortSignal
    );

    return {
      providerId: this.providerId,
      objectKey: safeKey,
      url: presignData.publicUrl,
      sizeBytes: req.file.size,
      mimeType: req.mimeType,
      checksumSha256,
      etag,
      acceptRanges: true,
      uploadedAtIso: new Date().toISOString(),
    };
  }

  async downloadObject(objectKey: string): Promise<ArrayBuffer> {
    const safeKey = sanitizeObjectKey(objectKey);
    const url = await this.getPlaybackUrl(safeKey);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Failed to download ${safeKey} (${resp.status}).`);
    }
    return resp.arrayBuffer();
  }

  async getPlaybackUrl(objectKey: string, publicUrlHint?: string): Promise<string> {
    const safeKey = sanitizeObjectKey(objectKey);
    if (this.config.publicCdnBaseUrl) {
      return `${this.config.publicCdnBaseUrl.replace(/\/+$/, '')}/${safeKey}`;
    }
    const broker = resolveBrokerBaseUrl(this.config);
    if (broker) {
      const headers = await getAuthHeader();
      const resp = await fetch(`${broker}/api/media/presign-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          providerId: this.providerId,
          objectKey: safeKey,
          bucketName: this.config.bucketName || '',
          endpointUrl: this.config.endpointUrl || '',
          region: this.config.region || 'auto',
          publicCdnBaseUrl: this.config.publicCdnBaseUrl || '',
        }),
      }).catch(() => null);
      if (resp && resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as { downloadUrl?: string };
        if (data.downloadUrl) return data.downloadUrl;
      }
    }
    if (publicUrlHint) return publicUrlHint;
    throw new Error(`Cannot resolve playback URL for ${safeKey}.`);
  }

  async headObject(objectKey: string): Promise<HeadObjectResult> {
    const broker = this.assertConfigured();
    const safeKey = sanitizeObjectKey(objectKey);
    const headers = await getAuthHeader();
    const resp = await fetch(`${broker}/api/media/head`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        providerId: this.providerId,
        objectKey: safeKey,
        bucketName: this.config.bucketName || '',
        endpointUrl: this.config.endpointUrl || '',
        region: this.config.region || 'auto',
      }),
    });
    if (!resp.ok) return { exists: false };
    const data = (await resp.json().catch(() => ({}))) as HeadObjectResult;
    return data;
  }

  async copyObjectFromUrl(params: {
    sourceUrl: string;
    targetObjectKey: string;
    expectedSha256?: string;
    mimeType?: string;
  }): Promise<{ ok: boolean; targetUrl: string; checksumSha256: string; sizeBytes: number }> {
    const broker = this.assertConfigured();
    const safeKey = sanitizeObjectKey(params.targetObjectKey);
    const headers = await getAuthHeader();

    const resp = await fetch(`${broker}/api/media/backup-copy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        sourceUrl: params.sourceUrl,
        targetProviderId: this.providerId,
        targetObjectKey: safeKey,
        expectedSha256: params.expectedSha256 || '',
        contentType: params.mimeType || 'application/octet-stream',
        bucketName: this.config.bucketName || '',
        endpointUrl: this.config.endpointUrl || '',
        region: this.config.region || 'auto',
        publicCdnBaseUrl: this.config.publicCdnBaseUrl || '',
      }),
    });

    const data = (await resp.json().catch(() => ({}))) as {
      ok?: boolean;
      targetUrl?: string;
      checksumSha256?: string;
      sizeBytes?: number;
      error?: string;
    };

    if (!resp.ok || !data.ok || !data.targetUrl || !data.checksumSha256) {
      throw new Error(data.error || `Server-side backup copy failed (${resp.status}).`);
    }

    return {
      ok: true,
      targetUrl: data.targetUrl,
      checksumSha256: data.checksumSha256,
      sizeBytes: Number(data.sizeBytes || 0),
    };
  }

  async deleteObject(objectKey: string): Promise<void> {
    const broker = this.assertConfigured();
    const safeKey = sanitizeObjectKey(objectKey);
    const headers = await getAuthHeader();
    const resp = await fetch(`${broker}/api/media/object`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        providerId: this.providerId,
        objectKey: safeKey,
        bucketName: this.config.bucketName || '',
        endpointUrl: this.config.endpointUrl || '',
        region: this.config.region || 'auto',
      }),
    });
    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error || `Delete failed (${resp.status}).`);
    }
  }

  async listObjects(prefix = '', maxKeys = 100): Promise<ListedStorageObject[]> {
    const broker = this.assertConfigured();
    const headers = await getAuthHeader();
    const resp = await fetch(`${broker}/api/media/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        providerId: this.providerId,
        prefix,
        maxKeys,
        bucketName: this.config.bucketName || '',
        endpointUrl: this.config.endpointUrl || '',
        region: this.config.region || 'auto',
      }),
    });
    if (!resp.ok) return [];
    const data = (await resp.json().catch(() => ({}))) as { items?: ListedStorageObject[] };
    return Array.isArray(data.items) ? data.items : [];
  }
}

export async function verifyDownloadedChecksum(url: string, expectedSha256: string): Promise<{
  verified: boolean;
  actualSha256: string;
  sizeBytes: number;
}> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Integrity check fetch failed (${resp.status})`);
  }
  const buffer = await resp.arrayBuffer();
  const actualSha256 = await computeBufferSha256(buffer);
  return {
    verified: actualSha256.toLowerCase() === expectedSha256.trim().toLowerCase(),
    actualSha256,
    sizeBytes: buffer.byteLength,
  };
}
