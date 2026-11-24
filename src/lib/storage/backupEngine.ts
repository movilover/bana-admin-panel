import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { verifyChecksumsMatch } from '@/src/lib/storage/checksum';
import {
  buildStorageAdapter,
  fetchStorageProviders,
  resolveActivePrimaryAndBackup,
} from '@/src/lib/storage/storageManager';
import { DEFAULT_RETENTION_POLICY } from '@/src/lib/storage/providerCatalog';
import { verifyDownloadedChecksum } from '@/src/lib/storage/adapters/workerBrokerAdapter';
import type {
  BackupAuditLogEntry,
  BackupJobRecord,
  MediaAssetRecord,
  RetentionPolicyConfig,
  StoryBackupRecord,
} from '@/src/types/storage';

export async function writeBackupAudit(
  actorUid: string,
  actorEmail: string,
  action: BackupAuditLogEntry['action'],
  targetType: string,
  targetId: string,
  summary: string,
  details?: Record<string, string | number | boolean>
): Promise<void> {
  await addDoc(collection(db, 'backupAuditLogs'), {
    actorUid,
    actorEmail,
    action,
    targetType,
    targetId,
    summary,
    details: details || {},
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

export async function fetchRetentionPolicy(): Promise<RetentionPolicyConfig> {
  try {
    const snap = await getDoc(doc(db, 'retentionSettings', 'default'));
    if (!snap.exists()) return DEFAULT_RETENTION_POLICY;
    return { ...DEFAULT_RETENTION_POLICY, ...(snap.data() as Partial<RetentionPolicyConfig>), id: 'default' };
  } catch {
    return DEFAULT_RETENTION_POLICY;
  }
}

export async function queueMissingBackups(adminUid: string, adminEmail: string): Promise<{
  queued: number;
  skippedNoSecondary: boolean;
}> {
  const { backup } = await resolveActivePrimaryAndBackup();
  if (!backup) {
    return { queued: 0, skippedNoSecondary: true };
  }

  const assetsSnap = await getDocs(query(collection(db, 'mediaAssets'), limit(200)));
  const jobsSnap = await getDocs(query(collection(db, 'backupJobs'), limit(250)));
  const existingAssetJobs = new Set(
    jobsSnap.docs
      .filter((d) => ['pending', 'running', 'completed', 'retrying'].includes(String(d.data().status)))
      .map((d) => String(d.data().mediaAssetId))
  );

  let queued = 0;
  for (const d of assetsSnap.docs) {
    const asset = { id: d.id, ...d.data() } as MediaAssetRecord;
    if (!asset.primaryUrl || !asset.checksumSha256) continue;
    if (asset.backupStatus === 'completed' && asset.backupUrl) continue;
    if (existingAssetJobs.has(asset.id)) continue;

    await addDoc(collection(db, 'backupJobs'), {
      mediaAssetId: asset.id,
      ownerUid: asset.ownerUid,
      sourceProvider: asset.primaryProvider,
      sourceObjectKey: asset.primaryObjectKey,
      sourceUrl: asset.primaryUrl,
      targetProvider: backup.providerId,
      targetObjectKey: `backups/${asset.primaryObjectKey}`,
      expectedSha256: asset.checksumSha256,
      sizeBytes: asset.sizeBytes || 0,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'mediaAssets', asset.id), {
      backupProvider: backup.providerId,
      backupObjectKey: `backups/${asset.primaryObjectKey}`,
      backupStatus: 'pending',
      lifecycleStatus: 'backup_pending',
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    queued += 1;
  }

  if (queued > 0) {
    await writeBackupAudit(
      adminUid,
      adminEmail,
      'upload_registered',
      'backupJobs',
      'batch',
      `Queued ${queued} unbacked media assets for secondary backup copy to ${backup.label}.`,
      { queued }
    );
  }

  return { queued, skippedNoSecondary: false };
}

export async function processBackupJob(
  job: BackupJobRecord,
  adminUid: string,
  adminEmail: string
): Promise<{ ok: boolean; status: BackupJobRecord['status']; message: string }> {
  const providers = await fetchStorageProviders();
  const targetConfig = providers.find((p) => p.providerId === job.targetProvider);
  if (!targetConfig || !targetConfig.enabled) {
    const msg = `Target backup provider (${job.targetProvider}) is unavailable or disabled.`;
    await updateDoc(doc(db, 'backupJobs', job.id), {
      status: 'failed',
      errorMessage: msg,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    return { ok: false, status: 'failed', message: msg };
  }

  const nextAttempt = (job.attempts || 0) + 1;
  await updateDoc(doc(db, 'backupJobs', job.id), {
    status: 'running',
    attempts: nextAttempt,
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  try {
    const adapter = buildStorageAdapter(targetConfig);
    const res = await adapter.copyObjectFromUrl({
      sourceUrl: job.sourceUrl,
      targetObjectKey: job.targetObjectKey,
      expectedSha256: job.expectedSha256,
    });

    if (!verifyChecksumsMatch(job.expectedSha256, res.checksumSha256)) {
      const mismatchMsg = `SHA-256 checksum mismatch after copy (expected ${job.expectedSha256.slice(0, 12)}, got ${res.checksumSha256.slice(0, 12)}).`;
      await updateDoc(doc(db, 'backupJobs', job.id), {
        status: 'corrupted',
        actualSha256: res.checksumSha256,
        errorMessage: mismatchMsg,
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'mediaAssets', job.mediaAssetId), {
        backupStatus: 'corrupted',
        lifecycleStatus: 'recovery_required',
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      await writeBackupAudit(
        adminUid,
        adminEmail,
        'integrity_mismatch',
        'backupJobs',
        job.id,
        mismatchMsg,
        { mediaAssetId: job.mediaAssetId }
      );
      return { ok: false, status: 'corrupted', message: mismatchMsg };
    }

    await updateDoc(doc(db, 'backupJobs', job.id), {
      status: 'completed',
      targetUrl: res.targetUrl,
      actualSha256: res.checksumSha256,
      errorMessage: '',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await updateDoc(doc(db, 'mediaAssets', job.mediaAssetId), {
      backupProvider: job.targetProvider,
      backupObjectKey: job.targetObjectKey,
      backupUrl: res.targetUrl,
      backupChecksumSha256: res.checksumSha256,
      backupStatus: 'completed',
      lifecycleStatus: 'backup_complete',
      integrityVerified: true,
      lastVerifiedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    // Propagate backup URL cleanly to storyBackups / reels / posts when linked
    const assetSnap = await getDoc(doc(db, 'mediaAssets', job.mediaAssetId)).catch(() => null);
    if (assetSnap?.exists()) {
      const asset = assetSnap.data() as MediaAssetRecord;
      if (asset.sourceCollection === 'reels' && asset.sourceDocId) {
        await updateDoc(doc(db, 'reels', asset.sourceDocId), {
          backupVideoUrl: res.targetUrl,
          backupProvider: job.targetProvider,
          backupObjectKey: job.targetObjectKey,
          processingStatus: 'backup_complete',
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      } else if (asset.sourceCollection === 'stories' && asset.sourceDocId) {
        await updateDoc(doc(db, 'storyBackups', asset.sourceDocId), {
          backupUrl: res.targetUrl,
          backupProvider: job.targetProvider,
          backupObjectKey: job.targetObjectKey,
          backupStatus: 'completed',
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
    }

    await writeBackupAudit(
      adminUid,
      adminEmail,
      'backup_completed',
      'backupJobs',
      job.id,
      `Verified SHA-256 backup copy to ${targetConfig.label} (${job.targetObjectKey}).`,
      { mediaAssetId: job.mediaAssetId, sizeBytes: res.sizeBytes }
    );

    return { ok: true, status: 'completed', message: 'Backup copy completed and SHA-256 verified.' };
  } catch (err: any) {
    const canRetry = nextAttempt < (job.maxAttempts || 3);
    const nextStatus: BackupJobRecord['status'] = canRetry ? 'retrying' : 'failed';
    const backoffMs = Math.pow(2, nextAttempt) * 30_000;
    const msg = err?.message || 'Backup copy failed.';

    await updateDoc(doc(db, 'backupJobs', job.id), {
      status: nextStatus,
      nextRetryAt: canRetry ? Date.now() + backoffMs : 0,
      errorMessage: msg,
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    await updateDoc(doc(db, 'mediaAssets', job.mediaAssetId), {
      backupStatus: nextStatus,
      errorMessage: msg,
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    await writeBackupAudit(
      adminUid,
      adminEmail,
      canRetry ? 'backup_retried' : 'backup_failed',
      'backupJobs',
      job.id,
      `${msg} (Attempt ${nextAttempt}/${job.maxAttempts || 3})`,
      { mediaAssetId: job.mediaAssetId }
    );

    return { ok: false, status: nextStatus, message: msg };
  }
}

export async function verifyMediaAssetIntegrity(
  asset: MediaAssetRecord,
  adminUid: string,
  adminEmail: string
): Promise<{ ok: boolean; primaryHealthy: boolean; backupHealthy: boolean; message: string }> {
  let primaryHealthy = false;
  let backupHealthy = false;
  const notes: string[] = [];

  if (asset.primaryUrl && asset.checksumSha256) {
    try {
      const check = await verifyDownloadedChecksum(asset.primaryUrl, asset.checksumSha256);
      primaryHealthy = check.verified;
      notes.push(
        check.verified
          ? `Primary (${asset.primaryProvider}) SHA-256 verified.`
          : `Primary (${asset.primaryProvider}) checksum mismatch!`
      );
    } catch (e: any) {
      notes.push(`Primary (${asset.primaryProvider}) unreachable: ${e?.message || 'Error'}`);
    }
  }

  if (asset.backupUrl && asset.checksumSha256) {
    try {
      const check = await verifyDownloadedChecksum(asset.backupUrl, asset.checksumSha256);
      backupHealthy = check.verified;
      notes.push(
        check.verified
          ? `Backup (${asset.backupProvider}) SHA-256 verified.`
          : `Backup (${asset.backupProvider}) checksum mismatch!`
      );
    } catch (e: any) {
      notes.push(`Backup (${asset.backupProvider}) unreachable: ${e?.message || 'Error'}`);
    }
  }

  const needsRecovery = !primaryHealthy && backupHealthy;
  await updateDoc(doc(db, 'mediaAssets', asset.id), {
    integrityVerified: primaryHealthy || backupHealthy,
    lifecycleStatus: needsRecovery
      ? 'recovery_required'
      : backupHealthy && primaryHealthy
      ? 'backup_complete'
      : asset.lifecycleStatus,
    lastVerifiedAt: serverTimestamp(),
    errorMessage: notes.join(' '),
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  await writeBackupAudit(
    adminUid,
    adminEmail,
    primaryHealthy ? 'integrity_verified' : 'integrity_mismatch',
    'mediaAssets',
    asset.id,
    notes.join(' | ')
  );

  return {
    ok: primaryHealthy || backupHealthy,
    primaryHealthy,
    backupHealthy,
    message: notes.join(' '),
  };
}

/**
 * Enforces retention rule blocking deletion of the sole remaining media copy unless explicitly overridden.
 */
export async function safeDeleteMediaAsset(
  asset: MediaAssetRecord,
  adminUid: string,
  adminEmail: string,
  allowSoleCopyDeletion = false
): Promise<{ deleted: boolean; blocked: boolean; message: string }> {
  const policy = await fetchRetentionPolicy();
  const hasPrimary = Boolean(asset.primaryUrl);
  const hasBackup = Boolean(asset.backupUrl && asset.backupStatus === 'completed');
  const copyCount = (hasPrimary ? 1 : 0) + (hasBackup ? 1 : 0);

  if (policy.preventDeleteIfSoleCopy && copyCount <= 1 && !allowSoleCopyDeletion) {
    const msg = 'Deletion blocked by Retention Policy: asset has only 1 verified copy remaining.';
    await writeBackupAudit(adminUid, adminEmail, 'delete_blocked_sole_copy', 'mediaAssets', asset.id, msg);
    return { deleted: false, blocked: true, message: msg };
  }

  const providers = await fetchStorageProviders();
  if (hasPrimary && asset.primaryObjectKey) {
    const pCfg = providers.find((p) => p.providerId === asset.primaryProvider);
    if (pCfg?.enabled) {
      await buildStorageAdapter(pCfg).deleteObject(asset.primaryObjectKey).catch(() => {});
    }
  }
  await deleteDoc(doc(db, 'mediaAssets', asset.id));
  await writeBackupAudit(
    adminUid,
    adminEmail,
    'story_purged',
    'mediaAssets',
    asset.id,
    `Deleted mediaAsset ${asset.fileName} (${asset.id}).`
  );
  return { deleted: true, blocked: false, message: 'Media asset record removed.' };
}

/**
 * Archives expired stories (>24h) into `storyBackups` and marks expired from public feed cleanly.
 */
export async function syncExpiredStoriesToBackups(
  adminUid: string,
  adminEmail: string
): Promise<{ archivedCount: number }> {
  const policy = await fetchRetentionPolicy();
  const now = Date.now();
  const snap = await getDocs(query(collection(db, 'stories'), limit(200)));
  let archivedCount = 0;

  for (const d of snap.docs) {
    const data = d.data() as any;
    const expiresAtMs = data.expiresAt?.toMillis
      ? data.expiresAt.toMillis()
      : data.createdAt?.toMillis
      ? data.createdAt.toMillis() + 24 * 60 * 60 * 1000
      : now - 1000;
    if (expiresAtMs <= now && data.status !== 'expired' && data.status !== 'archived') {
      const retentionUntilMs = now + policy.storyRetentionDays * 24 * 60 * 60 * 1000;
      const backupPayload: Omit<StoryBackupRecord, 'id'> = {
        storyId: d.id,
        authorId: String(data.authorId || ''),
        authorUsername: String(data.authorUsername || ''),
        authorName: String(data.authorName || ''),
        mediaType: data.mediaType || 'text',
        caption: data.caption || '',
        primaryUrl: data.mediaUrl || '',
        primaryObjectKey: data.objectKey || '',
        primaryProvider: data.storageProvider || undefined,
        backupUrl: data.backupMediaUrl || '',
        checksumSha256: data.checksumSha256 || '',
        backupStatus: data.mediaType === 'text' ? 'text_only' : data.backupMediaUrl ? 'completed' : 'pending',
        visibility: data.visibility || 'public',
        createdAt: data.createdAt || serverTimestamp(),
        expiresAtMs,
        expiredFromFeed: true,
        retentionUntilMs,
        retainedUnderPolicy: policy.enableStoryBackupArchival,
        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, 'stories', d.id), {
        status: 'expired',
      }).catch(() => {});

      const existingBackup = await getDoc(doc(db, 'storyBackups', d.id)).catch(() => null);
      if (existingBackup && existingBackup.exists()) {
        await updateDoc(doc(db, 'storyBackups', d.id), {
          expiredFromFeed: true,
          retentionUntilMs,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      } else {
        await updateDoc(doc(db, 'storyBackups', d.id), backupPayload).catch(async () => {
          const { setDoc } = await import('firebase/firestore');
          await setDoc(doc(db, 'storyBackups', d.id), backupPayload);
        });
      }
      archivedCount += 1;
    }
  }

  if (archivedCount > 0) {
    await writeBackupAudit(
      adminUid,
      adminEmail,
      'story_archived_expired',
      'storyBackups',
      'sync',
      `Marked ${archivedCount} 24h-expired stories hidden from public feed and preserved in storyBackups under ${policy.storyRetentionDays}-day retention policy.`
    );
  }

  return { archivedCount };
}

export async function purgeExpiredStoryBackup(
  storyId: string,
  adminUid: string,
  adminEmail: string
): Promise<void> {
  await deleteDoc(doc(db, 'storyBackups', storyId));
  await deleteDoc(doc(db, 'stories', storyId)).catch(() => {});
  await writeBackupAudit(
    adminUid,
    adminEmail,
    'story_purged',
    'storyBackups',
    storyId,
    `Permanently purged story backup ${storyId} under admin command.`
  );
}

export async function listFailedOrPendingBackupJobs(): Promise<BackupJobRecord[]> {
  const snap = await getDocs(
    query(collection(db, 'backupJobs'), where('status', 'in', ['pending', 'retrying', 'failed', 'corrupted']), limit(100))
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as BackupJobRecord);
}
