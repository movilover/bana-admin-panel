import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { computeStringSha256 } from '@/src/lib/storage/checksum';
import { writeBackupAudit } from '@/src/lib/storage/backupEngine';
import type { DatabaseManifestExport } from '@/src/types/storage';

const SENSITIVE_FIELD_BLOCKLIST = new Set([
  'email',
  'phone',
  'phoneNumber',
  'password',
  'passwordHash',
  'secretAccessKey',
  'accessKeyId',
  'apiKey',
  'token',
  'refreshToken',
  'idToken',
  'serviceAccountJson',
  'privateKey',
  'payoutAccount',
  'paymentDetails',
  'documentUrl',
]);

function normalizeFirestoreValue(val: unknown): unknown {
  if (val === null || val === undefined) return null;
  if (typeof val === 'object' && val !== null && typeof (val as any).toDate === 'function') {
    return (val as any).toDate().toISOString();
  }
  if (Array.isArray(val)) {
    return val.map(normalizeFirestoreValue);
  }
  if (typeof val === 'object') {
    const out: Record<string, unknown> = {};
    Object.entries(val as Record<string, unknown>).forEach(([k, v]) => {
      if (SENSITIVE_FIELD_BLOCKLIST.has(k)) return;
      if (/secret|token|password|private_key/i.test(k)) return;
      out[k] = normalizeFirestoreValue(v);
    });
    return out;
  }
  return val;
}

function sanitizeDocs(
  docs: Array<{ id: string; data: () => Record<string, unknown> }>
): Record<string, unknown>[] {
  return docs.map((d) => {
    const clean = normalizeFirestoreValue(d.data()) as Record<string, unknown>;
    return { id: d.id, ...clean };
  });
}

async function fetchCollectionForManifest(colName: string, maxRows = 500) {
  try {
    const snap = await getDocs(query(collection(db, colName), limit(maxRows)));
    return sanitizeDocs(snap.docs as any);
  } catch {
    return [];
  }
}

export async function generateDatabaseBackupManifest(
  adminUid: string,
  adminEmail: string
): Promise<{ manifest: DatabaseManifestExport; snapshotId: string }> {
  const [
    usersPublic,
    posts,
    reels,
    stories,
    storyBackups,
    storyReplies,
    comments,
    voiceComments,
    mediaAssets,
    backupJobs,
    communities,
    marketplaceListings,
    storageProviders,
    retentionSettings,
  ] = await Promise.all([
    fetchCollectionForManifest('users', 400),
    fetchCollectionForManifest('posts', 400),
    fetchCollectionForManifest('reels', 400),
    fetchCollectionForManifest('stories', 300),
    fetchCollectionForManifest('storyBackups', 400),
    fetchCollectionForManifest('storyReplies', 400),
    fetchCollectionForManifest('comments', 500),
    fetchCollectionForManifest('voiceComments', 300),
    fetchCollectionForManifest('mediaAssets', 500),
    fetchCollectionForManifest('backupJobs', 400),
    fetchCollectionForManifest('communities', 200),
    fetchCollectionForManifest('marketplaceListings', 300),
    fetchCollectionForManifest('storageProviders', 20),
    fetchCollectionForManifest('retentionSettings', 10),
  ]);

  const collectionsData = {
    usersPublic,
    posts,
    reels,
    stories,
    storyBackups,
    storyReplies,
    comments,
    voiceComments,
    mediaAssets,
    backupJobs,
    communities,
    marketplaceListings,
    storageProviders,
    retentionSettings,
  };

  const recordCounts: Record<string, number> = Object.fromEntries(
    Object.entries(collectionsData).map(([k, arr]) => [k, arr.length])
  );

  const exportedAtIso = new Date().toISOString();
  const payloadForHash = JSON.stringify({
    schemaVersion: 'bana-manifest-v1',
    platform: 'BANA',
    projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || 'bana-a5770'),
    exportedAtIso,
    collections: collectionsData,
  });
  const checksumSha256 = await computeStringSha256(payloadForHash);

  const manifest: DatabaseManifestExport = {
    schemaVersion: 'bana-manifest-v1',
    platform: 'BANA',
    projectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || 'bana-a5770'),
    exportedAtIso,
    exportedByUid: adminUid,
    excludedSensitiveFields: Array.from(SENSITIVE_FIELD_BLOCKLIST),
    recordCounts,
    checksumSha256,
    collections: collectionsData,
  };

  const snapRef = await addDoc(collection(db, 'databaseSnapshots'), {
    schemaVersion: manifest.schemaVersion,
    exportedAtIso,
    exportedByUid: adminUid,
    recordCounts,
    checksumSha256,
    totalRecords: Object.values(recordCounts).reduce((a, b) => a + b, 0),
    createdAt: serverTimestamp(),
  });

  await writeBackupAudit(
    adminUid,
    adminEmail,
    'db_manifest_exported',
    'databaseSnapshots',
    snapRef.id,
    `Exported secret-free database manifest (${Object.values(recordCounts).reduce((a, b) => a + b, 0)} records, SHA-256 ${checksumSha256.slice(0, 12)}).`
  );

  return { manifest, snapshotId: snapRef.id };
}

export interface ManifestValidationResult {
  valid: boolean;
  checksumMatched: boolean;
  hasLeakedSecrets: boolean;
  totalRecords: number;
  recordCounts: Record<string, number>;
  errors: string[];
}

export async function validateBackupManifest(
  rawJson: string
): Promise<{ validation: ManifestValidationResult; manifest?: DatabaseManifestExport }> {
  const errors: string[] = [];
  let parsed: any;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return {
      validation: {
        valid: false,
        checksumMatched: false,
        hasLeakedSecrets: false,
        totalRecords: 0,
        recordCounts: {},
        errors: ['Invalid JSON file format.'],
      },
    };
  }

  if (parsed?.schemaVersion !== 'bana-manifest-v1' || !parsed?.collections) {
    errors.push('Missing or unsupported schemaVersion (expected bana-manifest-v1).');
  }

  // Detect any leaked secret keys in JSON text
  const leakedSecretPattern = /"(secretAccessKey|privateKey|passwordHash|serviceAccountJson)"\s*:\s*"[^"]+"/i;
  const hasLeakedSecrets = leakedSecretPattern.test(rawJson);
  if (hasLeakedSecrets) {
    errors.push('Manifest rejected: detected restricted credential fields inside payload.');
  }

  const payloadForHash = JSON.stringify({
    schemaVersion: parsed?.schemaVersion,
    platform: parsed?.platform,
    projectId: parsed?.projectId,
    exportedAtIso: parsed?.exportedAtIso,
    collections: parsed?.collections,
  });
  const computed = await computeStringSha256(payloadForHash);
  const checksumMatched =
    typeof parsed?.checksumSha256 === 'string' &&
    computed.toLowerCase() === parsed.checksumSha256.toLowerCase();

  if (!checksumMatched) {
    errors.push('SHA-256 manifest checksum verification failed (file modified or corrupted).');
  }

  const counts: Record<string, number> = {};
  let totalRecords = 0;
  if (parsed?.collections && typeof parsed.collections === 'object') {
    Object.entries(parsed.collections).forEach(([k, v]) => {
      const len = Array.isArray(v) ? v.length : 0;
      counts[k] = len;
      totalRecords += len;
    });
  }

  return {
    validation: {
      valid: errors.length === 0,
      checksumMatched,
      hasLeakedSecrets,
      totalRecords,
      recordCounts: counts,
      errors,
    },
    manifest: errors.length === 0 ? (parsed as DatabaseManifestExport) : undefined,
  };
}

/**
 * Restores selected safe metadata records (storageProviders, retentionSettings, storyBackups, mediaAssets)
 * after strict manifest checksum validation.
 */
export async function importValidatedManifestSubset(
  manifest: DatabaseManifestExport,
  adminUid: string,
  adminEmail: string,
  opts: {
    restoreProviders?: boolean;
    restoreRetention?: boolean;
    restoreMediaRefs?: boolean;
  }
): Promise<{ restoredCount: number }> {
  let restoredCount = 0;

  if (opts.restoreRetention && Array.isArray(manifest.collections.retentionSettings)) {
    for (const row of manifest.collections.retentionSettings) {
      const id = String((row as any).id || 'default');
      const { id: _ignore, ...rest } = row as any;
      await setDoc(doc(db, 'retentionSettings', id), {
        ...rest,
        updatedBy: adminUid,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      restoredCount += 1;
    }
  }

  if (opts.restoreProviders && Array.isArray(manifest.collections.storageProviders)) {
    for (const row of manifest.collections.storageProviders) {
      const id = String((row as any).providerId || (row as any).id || '');
      if (!id) continue;
      const { id: _ignore, ...rest } = row as any;
      await setDoc(doc(db, 'storageProviders', id), {
        ...rest,
        updatedBy: adminUid,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      restoredCount += 1;
    }
  }

  if (opts.restoreMediaRefs && Array.isArray(manifest.collections.mediaAssets)) {
    for (const row of manifest.collections.mediaAssets) {
      const id = String((row as any).id || '');
      if (!id) continue;
      const { id: _ignore, ...rest } = row as any;
      await setDoc(doc(db, 'mediaAssets', id), {
        ...rest,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      restoredCount += 1;
    }
  }

  await writeBackupAudit(
    adminUid,
    adminEmail,
    'db_manifest_restored',
    'databaseSnapshots',
    manifest.checksumSha256.slice(0, 16),
    `Imported ${restoredCount} validated manifest records from export ${manifest.exportedAtIso}.`
  );

  return { restoredCount };
}
