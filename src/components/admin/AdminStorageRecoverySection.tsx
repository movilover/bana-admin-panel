import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  Film,
  HardDrive,
  History,
  Loader2,
  MessageSquare,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import {
  DEFAULT_RETENTION_POLICY,
  PROVIDER_QUOTA_CATALOG,
} from '@/src/lib/storage/providerCatalog';
import {
  buildStorageAdapter,
  evaluateQuotaAlerts,
  fetchStorageProviders,
  saveStorageProviderConfig,
} from '@/src/lib/storage/storageManager';
import {
  fetchRetentionPolicy,
  processBackupJob,
  purgeExpiredStoryBackup,
  queueMissingBackups,
  safeDeleteMediaAsset,
  syncExpiredStoriesToBackups,
  verifyMediaAssetIntegrity,
  writeBackupAudit,
} from '@/src/lib/storage/backupEngine';
import {
  generateDatabaseBackupManifest,
  importValidatedManifestSubset,
  validateBackupManifest,
  type ManifestValidationResult,
} from '@/src/lib/storage/databaseBackup';
import {
  executeOneClickRecovery,
  type RecoveryRunResult,
} from '@/src/lib/storage/recoveryEngine';
import {
  purgeCommentPermanently,
  restoreSoftDeletedComment,
} from '@/src/lib/comments';
import type {
  BackupAuditLogEntry,
  BackupJobRecord,
  DatabaseManifestExport,
  MediaAssetRecord,
  RecoveryOperationRecord,
  RetentionPolicyConfig,
  StorageProviderConfig,
  StorageProviderId,
  StoryBackupRecord,
} from '@/src/types/storage';

type SubTabId =
  | 'overview'
  | 'videos'
  | 'stories'
  | 'comments'
  | 'providers'
  | 'backups'
  | 'export'
  | 'recovery'
  | 'quotas'
  | 'audit'
  | 'retention';

const SUB_TABS: { id: SubTabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Storage Overview', icon: HardDrive },
  { id: 'videos', label: 'Video Management', icon: Film },
  { id: 'stories', label: 'Story Backup', icon: Archive },
  { id: 'comments', label: 'Comment Database', icon: MessageSquare },
  { id: 'providers', label: 'Storage Providers', icon: Cloud },
  { id: 'backups', label: 'Backup Manager', icon: RefreshCw },
  { id: 'export', label: 'Database Export', icon: Database },
  { id: 'recovery', label: 'Recovery Center', icon: RotateCcw },
  { id: 'quotas', label: 'Usage & Quota', icon: Activity },
  { id: 'audit', label: 'Backup Audit Logs', icon: History },
  { id: 'retention', label: 'Retention Settings', icon: Settings2 },
];

interface AdminStorageRecoveryProps {
  currentUid: string;
  currentEmail: string;
  comments: any[];
  reels: any[];
  canManage: boolean;
  onNotifyAction: (msg: string) => void;
  onErrorAction: (msg: string) => void;
  onAskConfirm: (cfg: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    action: () => Promise<void>;
  }) => void;
}

function formatBytes(bytes: number | undefined): string {
  const b = Number(bytes || 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function AdminStorageRecoverySection({
  currentUid,
  currentEmail,
  comments,
  reels,
  canManage,
  onNotifyAction,
  onErrorAction,
  onAskConfirm,
}: AdminStorageRecoveryProps) {
  const [subTab, setSubTab] = useState<SubTabId>('overview');
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [providers, setProviders] = useState<StorageProviderConfig[]>([]);
  const [editingProviderId, setEditingProviderId] = useState<StorageProviderId | null>(null);
  const [providerDraft, setProviderDraft] = useState<StorageProviderConfig | null>(null);

  const [mediaAssets, setMediaAssets] = useState<MediaAssetRecord[]>([]);
  const [backupJobs, setBackupJobs] = useState<BackupJobRecord[]>([]);
  const [storyBackups, setStoryBackups] = useState<StoryBackupRecord[]>([]);
  const [retention, setRetention] = useState<RetentionPolicyConfig>(DEFAULT_RETENTION_POLICY);
  const [backupLogs, setBackupLogs] = useState<BackupAuditLogEntry[]>([]);
  const [recoveryOps, setRecoveryOps] = useState<RecoveryOperationRecord[]>([]);

  // Search / filters
  const [videoSearch, setVideoSearch] = useState('');
  const [videoStatusFilter, setVideoStatusFilter] = useState<string>('all');
  const [commentFilter, setCommentFilter] = useState<'all' | 'active' | 'soft_deleted' | 'flagged'>('all');

  // Manifest Export/Import
  const [lastManifest, setLastManifest] = useState<DatabaseManifestExport | null>(null);
  const [importValidation, setImportValidation] = useState<ManifestValidationResult | null>(null);
  const [importManifestObj, setImportManifestObj] = useState<DatabaseManifestExport | null>(null);

  // Recovery Center
  const [recoveryTargetProvider, setRecoveryTargetProvider] = useState<StorageProviderId>('cloudflare_r2');
  const [recoveryDryRun, setRecoveryDryRun] = useState(true);
  const [recoverySnapshotAck, setRecoverySnapshotAck] = useState(false);
  const [lastRecoveryResult, setLastRecoveryResult] = useState<RecoveryRunResult | null>(null);

  const loadStorageData = useCallback(async () => {
    setLoading(true);
    try {
      const safeList = async <T,>(col: string, orderField = 'createdAt', max = 120): Promise<T[]> => {
        try {
          const s = await getDocs(query(collection(db, col), orderBy(orderField, 'desc'), limit(max)));
          return s.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
        } catch {
          try {
            const s = await getDocs(query(collection(db, col), limit(max)));
            return s.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
          } catch {
            return [];
          }
        }
      };

      const [provList, assets, jobs, sBackups, retPol, logs, recOps] = await Promise.all([
        fetchStorageProviders(true),
        safeList<MediaAssetRecord>('mediaAssets', 'createdAt', 150),
        safeList<BackupJobRecord>('backupJobs', 'createdAt', 150),
        safeList<StoryBackupRecord>('storyBackups', 'expiresAtMs', 120),
        fetchRetentionPolicy(),
        safeList<BackupAuditLogEntry>('backupAuditLogs', 'createdAt', 100),
        safeList<RecoveryOperationRecord>('recoveryOperations', 'createdAt', 50),
      ]);

      setProviders(provList);
      setMediaAssets(assets);
      setBackupJobs(jobs);
      setStoryBackups(sBackups);
      setRetention(retPol);
      setBackupLogs(logs);
      setRecoveryOps(recOps);
    } catch (err: any) {
      onErrorAction(err?.message || 'Failed to load Storage & Disaster Recovery telemetry.');
    } finally {
      setLoading(false);
    }
  }, [onErrorAction]);

  useEffect(() => {
    void loadStorageData();
  }, [loadStorageData]);

  const primaryProvider = useMemo(
    () => providers.find((p) => p.role === 'primary' && p.enabled) || providers[0],
    [providers]
  );
  const secondaryProvider = useMemo(
    () => providers.find((p) => p.role === 'secondary_backup' && p.enabled) || null,
    [providers]
  );
  const quotaAlerts = useMemo(() => evaluateQuotaAlerts(providers, retention), [providers, retention]);

  const videoAssets = useMemo(() => {
    const q = videoSearch.trim().toLowerCase();
    return mediaAssets.filter((a) => {
      if (videoStatusFilter !== 'all' && a.lifecycleStatus !== videoStatusFilter) return false;
      if (!q) return true;
      return (
        a.fileName.toLowerCase().includes(q) ||
        a.primaryObjectKey.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.checksumSha256 || '').toLowerCase().includes(q)
      );
    });
  }, [mediaAssets, videoSearch, videoStatusFilter]);

  const filteredComments = useMemo(() => {
    return comments.filter((c) => {
      if (commentFilter === 'soft_deleted') return c.deletionStatus === 'soft_deleted';
      if (commentFilter === 'flagged') return c.moderationStatus === 'flagged' || c.moderationStatus === 'removed';
      if (commentFilter === 'active') return (!c.deletionStatus || c.deletionStatus === 'active') && c.moderationStatus !== 'removed';
      return true;
    });
  }, [comments, commentFilter]);

  const handleTestProvider = async (cfg: StorageProviderConfig) => {
    setBusyKey(`test_${cfg.providerId}`);
    try {
      const adapter = buildStorageAdapter(cfg);
      const res = await adapter.testConnection();
      const updated: StorageProviderConfig = {
        ...cfg,
        connectionStatus: res.status,
        lastTestedAt: res.testedAtIso,
        lastTestMessage: res.message,
        lastTestLatencyMs: res.latencyMs,
      };
      await saveStorageProviderConfig(updated, currentUid);
      await writeBackupAudit(
        currentUid,
        currentEmail,
        'provider_tested',
        'storageProviders',
        cfg.providerId,
        `${cfg.label} connection probe: ${res.status} — ${res.message}`
      );
      await loadStorageData();
      if (res.ok) onNotifyAction(`${cfg.label}: ${res.message}`);
      else onErrorAction(`${cfg.label}: ${res.message}`);
    } catch (err: any) {
      onErrorAction(err?.message || 'Probe failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveProviderEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!providerDraft || !canManage) return;
    if (providerDraft.providerId === 'cloudflare_stream' && providerDraft.enabled && !providerDraft.billingApproved) {
      onErrorAction('Cloudflare Stream requires explicit billing approval checkbox before enabling.');
      return;
    }
    setBusyKey(`save_${providerDraft.providerId}`);
    try {
      const hasBroker = Boolean((providerDraft.workerBrokerUrl || import.meta.env.VITE_MEDIA_BROKER_URL || '').trim());
      const nextStatus: StorageProviderConfig['connectionStatus'] = !providerDraft.enabled
        ? 'disabled'
        : hasBroker
        ? 'configured'
        : 'not_configured';

      await saveStorageProviderConfig({ ...providerDraft, connectionStatus: nextStatus }, currentUid);
      await writeBackupAudit(
        currentUid,
        currentEmail,
        'provider_configured',
        'storageProviders',
        providerDraft.providerId,
        `Updated configuration for ${providerDraft.label} (role=${providerDraft.role}, enabled=${providerDraft.enabled}).`
      );
      setEditingProviderId(null);
      setProviderDraft(null);
      await loadStorageData();
      onNotifyAction(`Saved ${providerDraft.label} metadata (secrets remain isolated outside Firestore).`);
    } catch (err: any) {
      onErrorAction(err?.message || 'Failed to save provider config.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleQueueBackups = async () => {
    setBusyKey('queue_backups');
    try {
      const res = await queueMissingBackups(currentUid, currentEmail);
      await loadStorageData();
      if (res.skippedNoSecondary) {
        onErrorAction('No active Secondary Backup provider configured.');
      } else {
        onNotifyAction(`Queued ${res.queued} unbacked media asset(s) for backup copy.`);
      }
    } catch (err: any) {
      onErrorAction(err?.message || 'Could not queue backups.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleRunPendingJobs = async () => {
    const eligible = backupJobs.filter((j) => ['pending', 'retrying', 'failed'].includes(j.status));
    if (eligible.length === 0) {
      onNotifyAction('No pending or retryable backup jobs right now.');
      return;
    }
    setBusyKey('run_jobs');
    try {
      let okCount = 0;
      let failCount = 0;
      for (const job of eligible.slice(0, 15)) {
        const r = await processBackupJob(job, currentUid, currentEmail);
        if (r.ok) okCount += 1;
        else failCount += 1;
      }
      await loadStorageData();
      if (failCount === 0) {
        onNotifyAction(`Processed ${okCount} backup job(s) with SHA-256 verification.`);
      } else {
        onErrorAction(`Backup batch finished: ${okCount} succeeded, ${failCount} failed/retrying.`);
      }
    } finally {
      setBusyKey(null);
    }
  };

  const handleExportManifest = async () => {
    setBusyKey('export_manifest');
    try {
      const { manifest } = await generateDatabaseBackupManifest(currentUid, currentEmail);
      setLastManifest(manifest);
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bana-db-manifest-${manifest.exportedAtIso.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await loadStorageData();
      onNotifyAction(`Downloaded secret-free DB manifest (SHA-256: ${manifest.checksumSha256.slice(0, 12)}...).`);
    } catch (err: any) {
      onErrorAction(err?.message || 'Failed to generate DB backup manifest.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleUploadManifestForValidation = async (file: File | null) => {
    if (!file) return;
    setBusyKey('validate_manifest');
    try {
      const text = await file.text();
      const { validation, manifest } = await validateBackupManifest(text);
      setImportValidation(validation);
      setImportManifestObj(manifest || null);
      await writeBackupAudit(
        currentUid,
        currentEmail,
        'db_manifest_validated',
        'databaseSnapshots',
        file.name,
        validation.valid
          ? `Manifest validated (${validation.totalRecords} records, SHA-256 verified).`
          : `Manifest validation rejected: ${validation.errors.join('; ')}`
      );
      if (validation.valid) onNotifyAction('Manifest JSON & SHA-256 checksum verified cleanly.');
      else onErrorAction(validation.errors[0] || 'Invalid backup manifest.');
    } catch (err: any) {
      onErrorAction(err?.message || 'Could not read manifest file.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleExecuteRecovery = async () => {
    if (!recoveryDryRun && !recoverySnapshotAck) {
      onErrorAction('Confirm pre-recovery snapshot acknowledgment before live recovery.');
      return;
    }
    setBusyKey('run_recovery');
    try {
      const res = await executeOneClickRecovery({
        targetPrimaryProvider: recoveryTargetProvider,
        sourceBackupProvider: secondaryProvider?.providerId || 'backblaze_b2',
        dryRun: recoveryDryRun,
        adminUid: currentUid,
        adminEmail: currentEmail,
      });
      setLastRecoveryResult(res);
      await loadStorageData();
      onNotifyAction(
        `${recoveryDryRun ? 'Dry-Run' : 'Recovery'} finished: ${res.record.recoveredCount}/${res.record.totalEligible} recovered, ${res.record.failedCount} failed.`
      );
    } catch (err: any) {
      onErrorAction(err?.message || 'Recovery execution failed.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveRetention = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) return;
    setBusyKey('save_retention');
    try {
      await setDoc(
        doc(db, 'retentionSettings', 'default'),
        {
          ...retention,
          id: 'default',
          updatedBy: currentUid,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
      await writeBackupAudit(
        currentUid,
        currentEmail,
        'retention_updated',
        'retentionSettings',
        'default',
        `Updated retention: stories=${retention.storyRetentionDays}d, softComments=${retention.softDeletedCommentRetentionDays}d, protectSoleCopy=${retention.preventDeleteIfSoleCopy}.`
      );
      onNotifyAction('Retention settings saved.');
    } catch (err: any) {
      onErrorAction(err?.message || 'Could not save retention policy.');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[#1877F2]" />
            <h2 className="font-display font-bold text-base">Storage &amp; Disaster Recovery Center</h2>
            <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-mono text-[10px] font-semibold">
              SPARK FREE MODE
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Multi-cloud object storage router, automatic SHA-256 backup engine, 24h story retention archival, and one-click recovery.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadStorageData()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Telemetry
        </button>
      </div>

      {/* Quota Warning Strip (70% / 85% / 95%) */}
      {quotaAlerts
        .filter((a) => a.severity !== 'ok')
        .map((alert) => (
          <div
            key={alert.providerId}
            className={`rounded-xl border px-4 py-2.5 text-xs flex items-center gap-2.5 ${
              alert.severity === 'critical_95'
                ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
                : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200'
            }`}
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{alert.message}</span>
          </div>
        ))}

      {/* Sub-navigation across all 11 modules */}
      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2 flex flex-wrap gap-1">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-[#1877F2] text-white'
                  : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. STORAGE OVERVIEW */}
      {subTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
              <p className="text-[11px] text-neutral-500">Tracked Media Assets</p>
              <p className="font-display font-bold text-2xl mt-1 tabular-nums">{mediaAssets.length}</p>
              <p className="text-[11px] text-neutral-500 mt-0.5">Reels total: {reels.length}</p>
            </div>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
              <p className="text-[11px] text-neutral-500">Verified Backups</p>
              <p className="font-display font-bold text-2xl mt-1 text-emerald-600 tabular-nums">
                {mediaAssets.filter((a) => a.backupStatus === 'completed').length}
              </p>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Pending/Retry: {backupJobs.filter((j) => ['pending', 'retrying', 'failed'].includes(j.status)).length}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
              <p className="text-[11px] text-neutral-500">Story Backups</p>
              <p className="font-display font-bold text-2xl mt-1 tabular-nums">{storyBackups.length}</p>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Archived (&gt;24h): {storyBackups.filter((s) => s.expiredFromFeed).length}
              </p>
            </div>
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
              <p className="text-[11px] text-neutral-500">Recovery Required</p>
              <p className="font-display font-bold text-2xl mt-1 text-rose-600 tabular-nums">
                {mediaAssets.filter((a) => a.lifecycleStatus === 'recovery_required').length}
              </p>
              <p className="text-[11px] text-neutral-500 mt-0.5">Soft-deleted comments: {comments.filter((c) => c.deletionStatus === 'soft_deleted').length}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-2">
              <h3 className="font-display font-bold text-sm">Active Primary &amp; Secondary Routing</h3>
              <div className="text-xs space-y-2">
                <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">Primary: {primaryProvider?.label || 'Unassigned'}</p>
                    <p className="text-[11px] text-neutral-500">
                      Status: <span className="font-mono uppercase">{primaryProvider?.connectionStatus || 'not_configured'}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSubTab('providers')}
                    className="px-2.5 py-1 rounded-lg bg-[#1877F2]/10 text-[#1877F2] font-semibold"
                  >
                    Configure
                  </button>
                </div>

                <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">Secondary Backup: {secondaryProvider?.label || 'None Enabled'}</p>
                    <p className="text-[11px] text-neutral-500">
                      Status: <span className="font-mono uppercase">{secondaryProvider?.connectionStatus || 'not_configured'}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSubTab('backups')}
                    className="px-2.5 py-1 rounded-lg bg-neutral-200 dark:bg-neutral-800 font-semibold"
                  >
                    Queue Jobs
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-2">
              <h3 className="font-display font-bold text-sm">Firebase Spark Compliance Guarantees</h3>
              <ul className="text-xs text-neutral-600 dark:text-neutral-300 space-y-1.5 list-disc pl-4">
                <li>Firebase Cloud Storage is disabled as active upload destination (avoids Blaze requirement).</li>
                <li>Cloud Functions remain disabled on Spark; presigned uploads use Cloudflare Worker Broker.</li>
                <li>Progressive MP4/WebM streaming with HTTP Range; paid Cloudflare Stream stays disabled unless explicitly approved.</li>
                <li>Zero API keys or storage secrets stored in frontend bundle, Firestore, or ZIP exports.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 2. VIDEO MANAGEMENT */}
      {subTab === 'videos' && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display font-bold text-sm">Media Assets &amp; Video Lifecycle</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={videoSearch}
                onChange={(e) => setVideoSearch(e.target.value)}
                placeholder="Search key, filename, SHA-256..."
                className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
              />
              <select
                value={videoStatusFilter}
                onChange={(e) => setVideoStatusFilter(e.target.value)}
                className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 text-xs"
              >
                <option value="all">All statuses</option>
                <option value="uploading">Uploading</option>
                <option value="upload_failed">Upload Failed</option>
                <option value="ready">Ready</option>
                <option value="backup_pending">Backup Pending</option>
                <option value="backup_complete">Backup Complete</option>
                <option value="recovery_required">Recovery Required</option>
              </select>
            </div>
          </div>

          {videoAssets.length === 0 ? (
            <p className="text-xs text-neutral-500 py-8 text-center">No tracked multi-cloud media assets matching your filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
                    <th className="py-2 pr-3">File &amp; Key</th>
                    <th className="py-2 pr-3">Primary / Backup</th>
                    <th className="py-2 pr-3">SHA-256</th>
                    <th className="py-2 pr-3">Lifecycle</th>
                    <th className="py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                  {videoAssets.map((asset) => (
                    <tr key={asset.id}>
                      <td className="py-2.5 pr-3">
                        <p className="font-semibold truncate max-w-[200px]">{asset.fileName}</p>
                        <p className="font-mono text-[10px] text-neutral-500 truncate max-w-[220px]">
                          {asset.primaryObjectKey} · {formatBytes(asset.sizeBytes)}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[11px]">
                        <p>1°: {asset.primaryProvider}</p>
                        <p className="text-neutral-500">2°: {asset.backupProvider || 'none'} ({asset.backupStatus})</p>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[10px] text-neutral-500">
                        {asset.checksumSha256 ? `${asset.checksumSha256.slice(0, 14)}…` : 'n/a'}
                      </td>
                      <td className="py-2.5 pr-3">
                        <span className="px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 font-mono text-[10px]">
                          {asset.lifecycleStatus}
                        </span>
                      </td>
                      <td className="py-2.5 text-right space-x-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          disabled={busyKey === `verify_${asset.id}`}
                          onClick={async () => {
                            setBusyKey(`verify_${asset.id}`);
                            try {
                              const r = await verifyMediaAssetIntegrity(asset, currentUid, currentEmail);
                              await loadStorageData();
                              if (r.ok) onNotifyAction(r.message);
                              else onErrorAction(r.message);
                            } finally {
                              setBusyKey(null);
                            }
                          }}
                          className="px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-[11px]"
                        >
                          Verify Checksum
                        </button>
                        {canManage && (
                          <button
                            type="button"
                            onClick={() =>
                              onAskConfirm({
                                title: `Remove media asset ${asset.fileName}?`,
                                description:
                                  'If Retention Settings protect the sole remaining copy, safe deletion will block this removal until a backup exists.',
                                confirmLabel: 'Check & Remove',
                                action: async () => {
                                  const res = await safeDeleteMediaAsset(asset, currentUid, currentEmail, false);
                                  await loadStorageData();
                                  if (res.blocked) onErrorAction(res.message);
                                  else onNotifyAction(res.message);
                                },
                              })
                            }
                            className="px-2 py-1 rounded-lg text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-[11px]"
                          >
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 3. STORY BACKUP */}
      {subTab === 'stories' && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display font-bold text-sm">24-Hour Story Backup &amp; Retention Archive</h3>
              <p className="text-xs text-neutral-500">
                Stories expire publicly after 24h while backup copies remain preserved for {retention.storyRetentionDays} days unless purged manually.
              </p>
            </div>
            <button
              type="button"
              disabled={busyKey === 'sync_stories'}
              onClick={async () => {
                setBusyKey('sync_stories');
                try {
                  const res = await syncExpiredStoriesToBackups(currentUid, currentEmail);
                  await loadStorageData();
                  onNotifyAction(`Synced stories: ${res.archivedCount} newly expired from public feed and archived.`);
                } finally {
                  setBusyKey(null);
                }
              }}
              className="px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-semibold inline-flex items-center gap-1.5"
            >
              <Archive className="w-3.5 h-3.5" /> Sync 24h Expired Stories
            </button>
          </div>

          {storyBackups.length === 0 ? (
            <p className="text-xs text-neutral-500 py-8 text-center">No story backup records yet.</p>
          ) : (
            <div className="space-y-2">
              {storyBackups.map((sb) => {
                const isExpired = sb.expiredFromFeed || sb.expiresAtMs <= Date.now();
                return (
                  <div
                    key={sb.id}
                    className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">
                        @{sb.authorUsername} · {sb.mediaType.toUpperCase()} Story
                        <span
                          className={`ml-2 px-1.5 py-0.5 rounded font-mono text-[10px] ${
                            isExpired
                              ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                              : 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                          }`}
                        >
                          {isExpired ? 'EXPIRED FROM FEED (ARCHIVED)' : 'ACTIVE ON FEED'}
                        </span>
                      </p>
                      <p className="text-neutral-500 truncate max-w-xl">{sb.caption || '(No caption)'}</p>
                      <p className="font-mono text-[10px] text-neutral-400">
                        Retention until: {new Date(sb.retentionUntilMs).toLocaleDateString()} · Backup: {sb.backupStatus}
                      </p>
                    </div>
                    {canManage && (
                      <button
                        type="button"
                        onClick={() =>
                          onAskConfirm({
                            title: `Permanently purge story backup (${sb.id})?`,
                            description: 'This permanently deletes the archival story backup record. Cannot be undone.',
                            confirmLabel: 'Permanent Purge',
                            action: async () => {
                              await purgeExpiredStoryBackup(sb.id, currentUid, currentEmail);
                              await loadStorageData();
                              onNotifyAction('Story backup permanently purged.');
                            },
                          })
                        }
                        className="px-2.5 py-1 rounded-lg text-rose-600 border border-rose-200 dark:border-rose-900 hover:bg-rose-50 dark:hover:bg-rose-950/30 text-[11px]"
                      >
                        <Trash2 className="w-3.5 h-3.5 inline mr-1" /> Purge
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. COMMENT DATABASE */}
      {subTab === 'comments' && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display font-bold text-sm">Comment Persistence &amp; Soft-Delete Recovery</h3>
              <p className="text-xs text-neutral-500">
                Inspect active, soft-deleted, and moderated comments/replies; restore soft-deleted items or purge permanently.
              </p>
            </div>
            <select
              value={commentFilter}
              onChange={(e) => setCommentFilter(e.target.value as any)}
              className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2.5 text-xs"
            >
              <option value="all">All comments ({comments.length})</option>
              <option value="active">Active</option>
              <option value="soft_deleted">Soft-Deleted</option>
              <option value="flagged">Flagged / Removed</option>
            </select>
          </div>

          <div className="space-y-2 max-h-[460px] overflow-y-auto">
            {filteredComments.map((c) => {
              const isSoftDeleted = c.deletionStatus === 'soft_deleted';
              return (
                <div
                  key={c.id}
                  className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">@{c.authorUsername}</span>
                      <span className="font-mono text-[10px] text-neutral-500">
                        {c.targetType}:{c.targetId}
                      </span>
                      {isSoftDeleted && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-mono text-[10px]">
                          SOFT DELETED
                        </span>
                      )}
                    </div>
                    <p className="text-neutral-700 dark:text-neutral-300 mt-0.5 break-words">{c.content}</p>
                    <p className="text-[10px] text-neutral-400 font-mono mt-0.5">
                      {formatRelativeTime(c.createdAt)} {c.parentCommentId ? `· Reply to ${c.parentCommentId}` : ''}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isSoftDeleted && (
                        <button
                          type="button"
                          onClick={async () => {
                            await restoreSoftDeletedComment(c.id, currentUid, currentEmail);
                            onNotifyAction('Soft-deleted comment restored.');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-medium"
                        >
                          Restore
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onAskConfirm({
                            title: 'Permanently delete comment?',
                            description: 'This erases the comment permanently from Firestore.',
                            confirmLabel: 'Permanent Delete',
                            action: async () => {
                              await purgeCommentPermanently(c.id, currentUid, currentEmail);
                              onNotifyAction('Comment permanently erased.');
                            },
                          })
                        }
                        className="px-2.5 py-1 rounded-lg border border-rose-200 dark:border-rose-900 text-rose-600 text-[11px]"
                      >
                        Purge
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 5. STORAGE PROVIDERS */}
      {subTab === 'providers' && (
        <div className="space-y-3">
          <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/20 p-3 text-xs text-blue-900 dark:text-blue-200">
            <strong>Security Guarantee:</strong> Provider API keys &amp; S3 secrets are stored ONLY in Cloudflare Worker secrets (`wrangler secret put`) and NEVER written to Firestore or frontend code. Connection status shows &ldquo;Connected&rdquo; ONLY after a real Upload + Download probe succeeds.
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {providers.map((p) => {
              const cat = PROVIDER_QUOTA_CATALOG[p.providerId];
              const editing = editingProviderId === p.providerId && providerDraft;
              return (
                <div
                  key={p.providerId}
                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-2.5 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-display font-bold text-sm">{p.label}</p>
                      <p className="text-[11px] text-neutral-500">
                        Role: <span className="font-mono">{p.role}</span> · Quota: {p.freeQuotaGB} GB free
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-semibold uppercase ${
                        p.connectionStatus === 'connected'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : p.connectionStatus === 'error'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                      }`}
                    >
                      {p.connectionStatus.replace(/_/g, ' ')}
                    </span>
                  </div>

                  {cat && (
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-400">
                      {cat.officialDocSummary}
                    </p>
                  )}

                  {p.lastTestMessage && (
                    <p className="text-[11px] font-mono text-neutral-500 bg-neutral-50 dark:bg-neutral-950 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800">
                      Last probe: {p.lastTestMessage}
                    </p>
                  )}

                  {editing ? (
                    <form onSubmit={handleSaveProviderEdit} className="space-y-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={providerDraft.role}
                          onChange={(e) => setProviderDraft({ ...providerDraft, role: e.target.value as any })}
                          className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2 text-xs"
                        >
                          <option value="primary">Primary</option>
                          <option value="secondary_backup">Secondary Backup</option>
                          <option value="optional">Optional</option>
                          <option value="transcoding">Transcoding</option>
                        </select>
                        <label className="flex items-center gap-2 text-xs px-2">
                          <input
                            type="checkbox"
                            checked={providerDraft.enabled}
                            onChange={(e) => setProviderDraft({ ...providerDraft, enabled: e.target.checked })}
                          />
                          Enabled
                        </label>
                      </div>
                      <input
                        type="text"
                        value={providerDraft.workerBrokerUrl || ''}
                        onChange={(e) => setProviderDraft({ ...providerDraft, workerBrokerUrl: e.target.value })}
                        placeholder="Cloudflare Worker Broker URL (https://...workers.dev)"
                        className="w-full h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={providerDraft.bucketName || ''}
                          onChange={(e) => setProviderDraft({ ...providerDraft, bucketName: e.target.value })}
                          placeholder="Bucket name"
                          className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
                        />
                        <input
                          type="text"
                          value={providerDraft.region || ''}
                          onChange={(e) => setProviderDraft({ ...providerDraft, region: e.target.value })}
                          placeholder="Region (e.g. auto)"
                          className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
                        />
                      </div>
                      <input
                        type="text"
                        value={providerDraft.endpointUrl || ''}
                        onChange={(e) => setProviderDraft({ ...providerDraft, endpointUrl: e.target.value })}
                        placeholder="S3 Endpoint URL (no secrets)"
                        className="w-full h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
                      />
                      <input
                        type="text"
                        value={providerDraft.publicCdnBaseUrl || ''}
                        onChange={(e) => setProviderDraft({ ...providerDraft, publicCdnBaseUrl: e.target.value })}
                        placeholder="Public CDN Custom Domain (https://media.example.com)"
                        className="w-full h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
                      />
                      {providerDraft.requiresBilling && (
                        <label className="flex items-center gap-2 text-[11px] text-rose-700 dark:text-rose-300">
                          <input
                            type="checkbox"
                            checked={Boolean(providerDraft.billingApproved)}
                            onChange={(e) => setProviderDraft({ ...providerDraft, billingApproved: e.target.checked })}
                          />
                          Explicitly approve paid provider billing on this account
                        </label>
                      )}
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProviderId(null);
                            setProviderDraft(null);
                          }}
                          className="px-3 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={busyKey === `save_${p.providerId}`}
                          className="px-3 py-1 rounded-lg bg-[#1877F2] text-white font-semibold"
                        >
                          Save Metadata
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800">
                      <button
                        type="button"
                        disabled={busyKey === `test_${p.providerId}`}
                        onClick={() => void handleTestProvider(p)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 font-semibold"
                      >
                        {busyKey === `test_${p.providerId}` ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Play className="w-3 h-3" />
                        )}
                        Run Live Upload+Download Test
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProviderId(p.providerId);
                            setProviderDraft({ ...p });
                          }}
                          className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        >
                          Edit Config
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 6. BACKUP MANAGER */}
      {subTab === 'backups' && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-display font-bold text-sm">Automatic Backup Queue &amp; Retry Manager</h3>
              <p className="text-xs text-neutral-500">
                Copies uploaded objects from Primary to Secondary Backup and validates matching SHA-256 checksums.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busyKey === 'queue_backups'}
                onClick={() => void handleQueueBackups()}
                className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-semibold"
              >
                Queue Unbacked Assets
              </button>
              <button
                type="button"
                disabled={busyKey === 'run_jobs'}
                onClick={() => void handleRunPendingJobs()}
                className="px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                {busyKey === 'run_jobs' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Process Pending / Failed Jobs
              </button>
            </div>
          </div>

          {backupJobs.length === 0 ? (
            <p className="text-xs text-neutral-500 py-8 text-center">No backup jobs recorded yet.</p>
          ) : (
            <div className="space-y-2 max-h-[460px] overflow-y-auto">
              {backupJobs.map((job) => (
                <div
                  key={job.id}
                  className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-semibold font-mono truncate max-w-md">{job.sourceObjectKey}</p>
                    <p className="text-[11px] text-neutral-500">
                      {job.sourceProvider} → {job.targetProvider} · {formatBytes(job.sizeBytes)} · Attempts: {job.attempts}/{job.maxAttempts}
                    </p>
                    {job.errorMessage && (
                      <p className="text-[11px] text-rose-600 mt-0.5">{job.errorMessage}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-semibold uppercase ${
                        job.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : job.status === 'failed' || job.status === 'corrupted'
                          ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
                      }`}
                    >
                      {job.status}
                    </span>
                    {job.status !== 'completed' && canManage && (
                      <button
                        type="button"
                        onClick={async () => {
                          setBusyKey(`job_${job.id}`);
                          try {
                            const r = await processBackupJob(job, currentUid, currentEmail);
                            await loadStorageData();
                            if (r.ok) onNotifyAction(r.message);
                            else onErrorAction(r.message);
                          } finally {
                            setBusyKey(null);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 font-medium"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 7. DATABASE EXPORT */}
      {subTab === 'export' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3 text-xs">
            <h3 className="font-display font-bold text-sm">Export Secret-Free Database Manifest</h3>
            <p className="text-neutral-600 dark:text-neutral-300">
              Exports structured JSON covering public profiles, posts, reels metadata, stories, storyBackups, comments, replies, mediaAssets, communities, marketplace listings, provider configs (no secrets), and retention settings with a SHA-256 verification checksum.
            </p>
            <button
              type="button"
              disabled={busyKey === 'export_manifest'}
              onClick={() => void handleExportManifest()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1877F2] text-white font-semibold"
            >
              {busyKey === 'export_manifest' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download JSON Backup Manifest
            </button>
            {lastManifest && (
              <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 font-mono text-[11px] space-y-1">
                <p>Schema: {lastManifest.schemaVersion}</p>
                <p>SHA-256: {lastManifest.checksumSha256.slice(0, 28)}…</p>
                <p>
                  Records:{' '}
                  {Object.entries(lastManifest.recordCounts)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(', ')}
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3 text-xs">
            <h3 className="font-display font-bold text-sm">Validate &amp; Restore Manifest</h3>
            <p className="text-neutral-600 dark:text-neutral-300">
              Upload a previously exported `bana-db-manifest-*.json` file to verify its SHA-256 integrity, reject any leaked credential fields, and optionally restore provider/retention/media asset metadata.
            </p>
            <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 font-semibold cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800">
              <Upload className="w-4 h-4" />
              Select Manifest JSON File
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => void handleUploadManifestForValidation(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>

            {importValidation && (
              <div
                className={`p-3 rounded-lg border text-[11px] space-y-1.5 ${
                  importValidation.valid
                    ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200'
                    : 'border-rose-200 bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200'
                }`}
              >
                <p className="font-semibold flex items-center gap-1.5">
                  {importValidation.valid ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                  {importValidation.valid
                    ? `Manifest Valid (${importValidation.totalRecords} total records)`
                    : 'Manifest Verification Failed'}
                </p>
                {importValidation.errors.map((err, i) => (
                  <p key={i}>• {err}</p>
                ))}
                {importValidation.valid && importManifestObj && canManage && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskConfirm({
                        title: 'Restore provider, retention & media references from manifest?',
                        description:
                          'Merges validated non-secret metadata back into Firestore storageProviders, retentionSettings, and mediaAssets.',
                        confirmLabel: 'Restore Validated Subset',
                        variant: 'primary',
                        action: async () => {
                          const r = await importValidatedManifestSubset(
                            importManifestObj,
                            currentUid,
                            currentEmail,
                            { restoreProviders: true, restoreRetention: true, restoreMediaRefs: true }
                          );
                          await loadStorageData();
                          onNotifyAction(`Restored ${r.restoredCount} validated manifest documents.`);
                        },
                      })
                    }
                    className="mt-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold"
                  >
                    Restore Config &amp; Media Refs
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 8. RECOVERY CENTER */}
      {subTab === 'recovery' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3 text-xs">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#1877F2]" />
              <h3 className="font-display font-bold text-sm">One-Click Disaster Recovery Workflow</h3>
            </div>
            <p className="text-neutral-600 dark:text-neutral-300">
              Restores media objects from verified Secondary Backup ({secondaryProvider?.label || 'backblaze_b2'}) to a selected Target Primary Provider, captures a pre-recovery Firestore snapshot, verifies SHA-256 checksums, and updates Firestore links while leaving original backup copies intact.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="block font-medium mb-1">Target New Primary Provider</label>
                <select
                  value={recoveryTargetProvider}
                  onChange={(e) => setRecoveryTargetProvider(e.target.value as StorageProviderId)}
                  className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2.5"
                >
                  {providers
                    .filter((p) => p.providerId !== 'cloudflare_stream')
                    .map((p) => (
                      <option key={p.providerId} value={p.providerId}>
                        {p.label} ({p.connectionStatus})
                      </option>
                    ))}
                </select>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  id="dryRunToggle"
                  type="checkbox"
                  checked={recoveryDryRun}
                  onChange={(e) => setRecoveryDryRun(e.target.checked)}
                />
                <label htmlFor="dryRunToggle" className="font-medium">
                  Dry-Run Verification Only (Safe Preview)
                </label>
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  id="snapAckToggle"
                  type="checkbox"
                  disabled={recoveryDryRun}
                  checked={recoverySnapshotAck}
                  onChange={(e) => setRecoverySnapshotAck(e.target.checked)}
                />
                <label htmlFor="snapAckToggle" className="font-medium">
                  Capture Pre-Recovery DB Snapshot
                </label>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                disabled={busyKey === 'run_recovery' || !canManage}
                onClick={() => {
                  if (recoveryDryRun) {
                    void handleExecuteRecovery();
                  } else {
                    onAskConfirm({
                      title: `Execute LIVE Disaster Recovery to ${recoveryTargetProvider}?`,
                      description:
                        'Creates a pre-recovery DB snapshot, restores backup media objects with SHA-256 checks, and updates primary URLs without deleting your secondary backups.',
                      confirmLabel: 'Run One-Click Recovery',
                      variant: 'primary',
                      action: handleExecuteRecovery,
                    });
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1877F2] text-white font-semibold"
              >
                {busyKey === 'run_recovery' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {recoveryDryRun ? 'Run Recovery Dry-Run' : 'Execute One-Click Live Recovery'}
              </button>
            </div>

            {lastRecoveryResult && (
              <div className="mt-3 p-3 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 space-y-2">
                <p className="font-semibold">
                  Recovery Summary ({lastRecoveryResult.record.status.toUpperCase()}) — Recovered:{' '}
                  {lastRecoveryResult.record.recoveredCount}, Skipped: {lastRecoveryResult.record.skippedCount}, Failed:{' '}
                  {lastRecoveryResult.record.failedCount}
                </p>
                {lastRecoveryResult.details.slice(0, 10).map((d) => (
                  <p key={d.assetId} className="font-mono text-[11px] text-neutral-600 dark:text-neutral-400">
                    [{d.status}] {d.fileName}: {d.message}
                  </p>
                ))}
              </div>
            )}
          </div>

          {recoveryOps.length > 0 && (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-2 text-xs">
              <h4 className="font-display font-bold text-sm">Past Recovery Operations</h4>
              {recoveryOps.map((op) => (
                <div key={op.id} className="p-2.5 rounded-lg border border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
                  <div>
                    <p className="font-semibold">
                      {op.sourceBackupProvider} → {op.targetPrimaryProvider} {op.dryRun ? '(Dry-Run)' : '(Live)'}
                    </p>
                    <p className="text-[11px] text-neutral-500">{op.notes}</p>
                  </div>
                  <span className="font-mono text-[11px]">{op.recoveredCount}/{op.totalEligible} ok</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 9. USAGE & QUOTA MONITOR */}
      {subTab === 'quotas' && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3 text-xs">
          <h3 className="font-display font-bold text-sm">Free-Tier Usage &amp; Threshold Alerts (70% / 85% / 95%)</h3>
          <div className="space-y-3">
            {providers.map((p) => {
              const cat = PROVIDER_QUOTA_CATALOG[p.providerId];
              const freeBytes = Math.max(1, (p.freeQuotaGB || 0) * 1024 * 1024 * 1024);
              const pct = p.freeQuotaGB > 0 ? Math.min(100, Math.round((Number(p.estimatedUsedBytes || 0) / freeBytes) * 1000) / 10) : 0;
              return (
                <div key={p.providerId} className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{p.label}</span>
                    <span className="font-mono">
                      {formatBytes(p.estimatedUsedBytes)} / {p.freeQuotaGB} GB ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                    <div
                      className={`h-full ${
                        pct >= 95 ? 'bg-rose-600' : pct >= 85 ? 'bg-amber-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-[#1877F2]'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {cat && (
                    <p className="text-[11px] text-neutral-500">
                      Egress: {cat.freeEgressDescription} · Ops: {cat.freeOperationsDescription}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 10. BACKUP AUDIT LOGS */}
      {subTab === 'audit' && (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-2 text-xs">
          <h3 className="font-display font-bold text-sm">Immutable Backup &amp; Recovery Audit History</h3>
          {backupLogs.length === 0 ? (
            <p className="text-neutral-500 py-6 text-center">No backup audit logs recorded yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-[460px] overflow-y-auto">
              {backupLogs.map((log) => (
                <div key={log.id} className="p-2.5 rounded-lg border border-neutral-100 dark:border-neutral-800 flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      <span className="font-mono text-[#1877F2] mr-1.5">{log.action}</span>
                      {log.summary}
                    </p>
                    <p className="text-[10px] text-neutral-500 font-mono">
                      Actor: {log.actorEmail || log.actorUid} · Target: {log.targetType}/{log.targetId}
                    </p>
                  </div>
                  <span className="text-[10px] text-neutral-400 shrink-0">{formatRelativeTime(log.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 11. RETENTION SETTINGS */}
      {subTab === 'retention' && (
        <form
          onSubmit={handleSaveRetention}
          className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3 text-xs"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#1877F2]" />
            <h3 className="font-display font-bold text-sm">Data Retention &amp; Deletion Safety Policy</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-medium mb-1">Story Backup Retention Days (after 24h feed expiry)</label>
              <input
                type="number"
                min={1}
                max={3650}
                value={retention.storyRetentionDays}
                onChange={(e) => setRetention({ ...retention, storyRetentionDays: Number(e.target.value) || 90 })}
                className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              />
            </div>
            <div>
              <label className="block font-medium mb-1">Soft-Deleted Comment Retention Days</label>
              <input
                type="number"
                min={1}
                max={3650}
                value={retention.softDeletedCommentRetentionDays}
                onChange={(e) =>
                  setRetention({ ...retention, softDeletedCommentRetentionDays: Number(e.target.value) || 30 })
                }
                className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              />
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={retention.autoBackupOnUpload}
                onChange={(e) => setRetention({ ...retention, autoBackupOnUpload: e.target.checked })}
              />
              Queue automatic secondary backup copy on every new video/media upload
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={retention.enableStoryBackupArchival}
                onChange={(e) => setRetention({ ...retention, enableStoryBackupArchival: e.target.checked })}
              />
              Retain Story backup media after 24h public feed expiration until retention expiry
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={retention.preventDeleteIfSoleCopy}
                onChange={(e) => setRetention({ ...retention, preventDeleteIfSoleCopy: e.target.checked })}
              />
              Block accidental deletion of sole remaining media copy unless backup copy exists
            </label>
          </div>

          <button
            type="submit"
            disabled={!canManage || busyKey === 'save_retention'}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1877F2] text-white font-semibold"
          >
            <Save className="w-3.5 h-3.5" /> Save Retention Policy
          </button>
        </form>
      )}
    </div>
  );
}
