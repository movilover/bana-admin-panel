import {
  addDoc,
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { readSessionCache, writeSessionCache } from '@/src/lib/firebasePlan';
import { computeBlobSha256 } from '@/src/lib/storage/checksum';
import { selectPrimaryAndBackup } from '@/src/lib/storage/providerSelection';
import { validateStorageProviderConfig } from '@/src/lib/providerValidation';
import {
  createDefaultProviderConfigs,
  DEFAULT_RETENTION_POLICY,
  PROVIDER_QUOTA_CATALOG,
} from '@/src/lib/storage/providerCatalog';
import {
  sanitizeObjectKey,
  type StorageAdapter,
} from '@/src/lib/storage/adapters/baseAdapter';
import { CloudflareR2Adapter } from '@/src/lib/storage/adapters/cloudflareR2Adapter';
import { BackblazeB2Adapter } from '@/src/lib/storage/adapters/backblazeB2Adapter';
import { GoogleCloudStorageAdapter } from '@/src/lib/storage/adapters/gcsAdapter';
import { SupabaseStorageAdapter } from '@/src/lib/storage/adapters/supabaseAdapter';
import { GenericS3Adapter } from '@/src/lib/storage/adapters/genericS3Adapter';
import { CloudflareStreamAdapter } from '@/src/lib/storage/adapters/cloudflareStreamAdapter';
import { resolveBrokerBaseUrl } from '@/src/lib/storage/adapters/workerBrokerAdapter';
import type {
  BackupJobRecord,
  MediaAssetRecord,
  MediaCategory,
  QuotaThresholdAlert,
  RetentionPolicyConfig,
  StorageObjectMetadata,
  StorageProviderConfig,
  StorageProviderId,
} from '@/src/types/storage';

const PROVIDERS_CACHE_KEY = 'bana_storage_providers_v1';
const inFlightUploadKeys = new Set<string>();

export function buildStorageAdapter(config: StorageProviderConfig): StorageAdapter {
  switch (config.providerId) {
    case 'cloudflare_r2':
      return new CloudflareR2Adapter(config);
    case 'backblaze_b2':
      return new BackblazeB2Adapter(config);
    case 'google_cloud_storage':
      return new GoogleCloudStorageAdapter(config);
    case 'supabase_storage':
      return new SupabaseStorageAdapter(config);
    case 'generic_s3':
      return new GenericS3Adapter(config);
    case 'cloudflare_stream':
      return new CloudflareStreamAdapter(config);
    default:
      return new GenericS3Adapter(config);
  }
}

export async function fetchStorageProviders(bypassCache = false): Promise<StorageProviderConfig[]> {
  if (!bypassCache) {
    const cached = readSessionCache<StorageProviderConfig[]>(PROVIDERS_CACHE_KEY, 60 * 1000);
    if (cached && cached.length > 0) return cached;
  }

  const brokerUrl = String(import.meta.env.VITE_MEDIA_BROKER_URL || '').trim();
  const defaults = createDefaultProviderConfigs(brokerUrl);

  try {
    const snap = await getDocs(collection(db, 'storageProviders'));
    if (snap.empty) {
      writeSessionCache(PROVIDERS_CACHE_KEY, defaults);
      return defaults;
    }

    const byId = new Map<string, StorageProviderConfig>();
    defaults.forEach((d) => byId.set(d.providerId, d));
    snap.docs.forEach((d) => {
      const data = d.data() as Partial<StorageProviderConfig>;
      const pid = (data.providerId || d.id) as StorageProviderId;
      const base = byId.get(pid);
      if (base) {
        byId.set(pid, {
          ...base,
          ...data,
          providerId: pid,
        });
      }
    });

    const merged = Array.from(byId.values());
    writeSessionCache(PROVIDERS_CACHE_KEY, merged);
    return merged;
  } catch {
    return defaults;
  }
}

export async function saveStorageProviderConfig(
  config: StorageProviderConfig,
  adminUid: string
): Promise<void> {
  // Prompt 12: reject malformed URLs and paid-but-unapproved enablement before any write.
  const validation = validateStorageProviderConfig(config);
  if (!validation.ok) {
    throw new Error(validation.errors.join(' '));
  }

  // Explicitly whitelist ONLY non-secret public metadata fields so no secrets ever enter Firestore.
  const sanitized: Omit<StorageProviderConfig, 'updatedAt'> & { updatedAt: any } = {
    providerId: config.providerId,
    label: config.label,
    role: config.role,
    enabled: Boolean(config.enabled),
    connectionStatus: config.connectionStatus,
    endpointUrl: String(config.endpointUrl || '').trim(),
    bucketName: String(config.bucketName || '').trim(),
    region: String(config.region || 'auto').trim(),
    publicCdnBaseUrl: String(config.publicCdnBaseUrl || '').trim(),
    workerBrokerUrl: String(config.workerBrokerUrl || '').trim(),
    requiresBilling: Boolean(config.requiresBilling),
    billingApproved: Boolean(config.billingApproved),
    freeQuotaGB: Number(config.freeQuotaGB || 0),
    estimatedUsedBytes: Number(config.estimatedUsedBytes || 0),
    estimatedMonthlyReads: Number(config.estimatedMonthlyReads || 0),
    estimatedMonthlyWrites: Number(config.estimatedMonthlyWrites || 0),
    lastTestedAt: config.lastTestedAt || null,
    lastTestMessage: config.lastTestMessage || '',
    lastTestLatencyMs: Number(config.lastTestLatencyMs || 0),
    notes: String(config.notes || '').slice(0, 400),
    updatedBy: adminUid,
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, 'storageProviders', config.providerId), sanitized, { merge: true });
  try {
    sessionStorage.removeItem(PROVIDERS_CACHE_KEY);
  } catch {
    // ignore storage restriction
  }
}

export async function resolveActivePrimaryAndBackup(): Promise<{
  primary: StorageProviderConfig;
  backup: StorageProviderConfig | null;
  all: StorageProviderConfig[];
}> {
  const all = await fetchStorageProviders();
  // Prompt 12: selection logic moved to a pure function; paid unapproved providers are never chosen.
  return selectPrimaryAndBackup(all);
}

export interface MultiCloudUploadOptions {
  ownerUid: string;
  objectKey: string;
  file: Blob | File;
  mimeType?: string;
  mediaCategory: MediaCategory;
  sourceCollection: MediaAssetRecord['sourceCollection'];
  sourceDocId?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  onProgress?: (pct: number) => void;
  abortSignal?: AbortSignal;
  overrideProviderConfig?: StorageProviderConfig;
  queueBackup?: boolean;
}

export interface MultiCloudUploadResult {
  assetId: string;
  metadata: StorageObjectMetadata;
  checksumSha256: string;
  backupJobId?: string;
}

export async function uploadToMultiCloudStorage(
  opts: MultiCloudUploadOptions
): Promise<MultiCloudUploadResult> {
  const safeKey = sanitizeObjectKey(opts.objectKey);
  const checksumSha256 = await computeBlobSha256(opts.file);
  const dedupeKey = `${opts.ownerUid}_${safeKey}_${checksumSha256.slice(0, 12)}`;

  if (inFlightUploadKeys.has(dedupeKey)) {
    throw new Error('Duplicate upload already in progress for this exact file.');
  }

  inFlightUploadKeys.add(dedupeKey);
  try {
    const { primary, backup } = await resolveActivePrimaryAndBackup();
    const targetConfig = opts.overrideProviderConfig || primary;
    const brokerUrl = resolveBrokerBaseUrl(targetConfig);

    if (!brokerUrl) {
      throw new Error(
        `Multi-cloud upload blocked: ${targetConfig.label} has no Media Broker configured. Deploy workers/bana-media-broker and set VITE_MEDIA_BROKER_URL (or configure Worker URL in Admin -> Storage & Recovery).`
      );
    }

    const mimeType =
      opts.mimeType ||
      (opts.file instanceof File ? opts.file.type : 'application/octet-stream') ||
      'application/octet-stream';

    // Pre-create mediaAsset row in 'uploading' state
    const assetDocRef = await addDoc(collection(db, 'mediaAssets'), {
      ownerUid: opts.ownerUid,
      mediaCategory: opts.mediaCategory,
      sourceCollection: opts.sourceCollection,
      sourceDocId: opts.sourceDocId || '',
      fileName: opts.file instanceof File ? opts.file.name : safeKey.split('/').pop() || 'media',
      mimeType,
      sizeBytes: opts.file.size,
      durationSeconds: opts.durationSeconds || 0,
      width: opts.width || 0,
      height: opts.height || 0,
      primaryProvider: targetConfig.providerId,
      primaryObjectKey: safeKey,
      primaryUrl: '',
      backupProvider: backup?.providerId || null,
      backupObjectKey: backup ? `backups/${safeKey}` : '',
      backupUrl: '',
      checksumSha256,
      lifecycleStatus: 'uploading',
      backupStatus: backup ? 'pending' : 'none',
      integrityVerified: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const adapter = buildStorageAdapter(targetConfig);
    try {
      const metadata = await adapter.uploadObject({
        objectKey: safeKey,
        file: opts.file,
        mimeType,
        checksumSha256,
        onProgress: opts.onProgress,
        abortSignal: opts.abortSignal,
      });

      const shouldQueueBackup = Boolean(
        opts.queueBackup !== false && backup && resolveBrokerBaseUrl(backup)
      );

      await updateDoc(assetDocRef, {
        primaryUrl: metadata.url,
        lifecycleStatus: shouldQueueBackup ? 'backup_pending' : 'ready',
        backupStatus: shouldQueueBackup ? 'pending' : 'none',
        integrityVerified: true,
        lastVerifiedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      let backupJobId: string | undefined;
      if (shouldQueueBackup && backup) {
        const jobData: Omit<BackupJobRecord, 'id' | 'createdAt' | 'updatedAt'> & {
          createdAt: any;
          updatedAt: any;
        } = {
          mediaAssetId: assetDocRef.id,
          ownerUid: opts.ownerUid,
          sourceProvider: targetConfig.providerId,
          sourceObjectKey: safeKey,
          sourceUrl: metadata.url,
          targetProvider: backup.providerId,
          targetObjectKey: `backups/${safeKey}`,
          expectedSha256: checksumSha256,
          sizeBytes: opts.file.size,
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };
        const jobRef = await addDoc(collection(db, 'backupJobs'), jobData);
        backupJobId = jobRef.id;
      }

      return {
        assetId: assetDocRef.id,
        metadata,
        checksumSha256,
        backupJobId,
      };
    } catch (uploadErr: any) {
      await updateDoc(assetDocRef, {
        lifecycleStatus: 'upload_failed',
        errorMessage: uploadErr?.message || 'Upload failed',
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      throw uploadErr;
    }
  } finally {
    inFlightUploadKeys.delete(dedupeKey);
  }
}

export function evaluateQuotaAlerts(
  providers: StorageProviderConfig[],
  policy: RetentionPolicyConfig = DEFAULT_RETENTION_POLICY
): QuotaThresholdAlert[] {
  return providers
    .filter((p) => p.enabled && p.freeQuotaGB > 0)
    .map((p) => {
      const freeBytes = p.freeQuotaGB * 1024 * 1024 * 1024;
      const used = Number(p.estimatedUsedBytes || 0);
      const pct = freeBytes > 0 ? Math.min(100, Math.round((used / freeBytes) * 1000) / 10) : 0;

      let severity: QuotaThresholdAlert['severity'] = 'ok';
      let message = `${PROVIDER_QUOTA_CATALOG[p.providerId]?.displayName || p.label}: ${pct}% of ${p.freeQuotaGB} GB free tier used.`;

      if (pct >= policy.quotaCriticalPct95) {
        severity = 'critical_95';
        message = `CRITICAL (>=${policy.quotaCriticalPct95}%): ${p.label} is nearly out of free tier storage (${pct}%). Enable overflow bucket or purge expired assets.`;
      } else if (pct >= policy.quotaWarnPct85) {
        severity = 'high_85';
        message = `HIGH WARNING (>=${policy.quotaWarnPct85}%): ${p.label} free tier usage is at ${pct}%. Plan archival or retention cleanup.`;
      } else if (pct >= policy.quotaWarnPct70) {
        severity = 'warning_70';
        message = `NOTICE (>=${policy.quotaWarnPct70}%): ${p.label} free tier usage reached ${pct}%.`;
      }

      return {
        providerId: p.providerId,
        label: p.label,
        usedBytes: used,
        freeQuotaBytes: freeBytes,
        utilizationPct: pct,
        severity,
        message,
      };
    });
}
