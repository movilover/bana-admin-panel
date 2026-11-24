export type StorageProviderId =
  | 'cloudflare_r2'
  | 'backblaze_b2'
  | 'google_cloud_storage'
  | 'supabase_storage'
  | 'generic_s3'
  | 'cloudflare_stream'
  | 'legacy_firebase_storage';

export type StorageProviderRole = 'primary' | 'secondary_backup' | 'optional' | 'transcoding';

export type StorageConnectionStatus =
  | 'not_configured'
  | 'configured'
  | 'connected'
  | 'error'
  | 'disabled';

export type VideoLifecycleStatus =
  | 'uploading'
  | 'upload_failed'
  | 'uploaded'
  | 'processing'
  | 'ready'
  | 'backup_pending'
  | 'backup_complete'
  | 'recovery_required';

export type BackupJobStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'corrupted';

export type MediaCategory =
  | 'reel'
  | 'post_video'
  | 'story'
  | 'voice'
  | 'image'
  | 'thumbnail'
  | 'captions'
  | 'document'
  | 'other';

export interface ProviderQuotaCatalogItem {
  providerId: StorageProviderId;
  displayName: string;
  defaultRole: StorageProviderRole;
  freeStorageGB: number;
  freeEgressDescription: string;
  freeOperationsDescription: string;
  maxSingleUploadHint: string;
  s3Compatible: boolean;
  requiresBillingCard: boolean;
  billingWarning: string;
  sparkCompatible: boolean;
  officialDocSummary: string;
}

/**
 * Stored in Firestore `storageProviders/{providerId}`.
 * SECURITY INVARIANT: Never contains access keys, secrets, tokens, or service account JSON.
 */
export interface StorageProviderConfig {
  providerId: StorageProviderId;
  label: string;
  role: StorageProviderRole;
  enabled: boolean;
  connectionStatus: StorageConnectionStatus;
  endpointUrl?: string;
  bucketName?: string;
  region?: string;
  publicCdnBaseUrl?: string;
  workerBrokerUrl?: string;
  requiresBilling: boolean;
  billingApproved?: boolean;
  freeQuotaGB: number;
  estimatedUsedBytes: number;
  estimatedMonthlyReads?: number;
  estimatedMonthlyWrites?: number;
  lastTestedAt?: any;
  lastTestMessage?: string;
  lastTestLatencyMs?: number;
  notes?: string;
  updatedBy?: string;
  updatedAt?: any;
}

export interface StorageObjectMetadata {
  providerId: StorageProviderId;
  objectKey: string;
  url: string;
  sizeBytes: number;
  mimeType: string;
  checksumSha256?: string;
  etag?: string;
  acceptRanges?: boolean;
  uploadedAtIso: string;
}

export interface MediaAssetRecord {
  id: string;
  ownerUid: string;
  mediaCategory: MediaCategory;
  sourceCollection: 'reels' | 'posts' | 'stories' | 'voiceComments' | 'messages' | 'marketplaceListings' | 'users' | 'communities' | 'adCreatives' | 'other';
  sourceDocId?: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  width?: number;
  height?: number;
  primaryProvider: StorageProviderId;
  primaryObjectKey: string;
  primaryUrl: string;
  backupProvider?: StorageProviderId;
  backupObjectKey?: string;
  backupUrl?: string;
  checksumSha256: string;
  backupChecksumSha256?: string;
  lifecycleStatus: VideoLifecycleStatus;
  backupStatus: BackupJobStatus | 'none';
  integrityVerified: boolean;
  lastVerifiedAt?: any;
  errorMessage?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface BackupJobRecord {
  id: string;
  mediaAssetId: string;
  ownerUid: string;
  sourceProvider: StorageProviderId;
  sourceObjectKey: string;
  sourceUrl: string;
  targetProvider: StorageProviderId;
  targetObjectKey: string;
  targetUrl?: string;
  expectedSha256: string;
  actualSha256?: string;
  sizeBytes: number;
  status: BackupJobStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: number;
  errorMessage?: string;
  completedAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

export interface StoryBackupRecord {
  id: string; // matches storyId
  storyId: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  mediaType: 'image' | 'video' | 'text';
  caption?: string;
  primaryUrl?: string;
  primaryObjectKey?: string;
  primaryProvider?: StorageProviderId;
  backupUrl?: string;
  backupObjectKey?: string;
  backupProvider?: StorageProviderId;
  checksumSha256?: string;
  backupStatus: BackupJobStatus | 'text_only' | 'none';
  visibility: 'public' | 'followers' | 'friends';
  createdAt?: any;
  expiresAtMs: number;
  expiredFromFeed: boolean;
  deletedByOwnerAt?: any;
  retentionUntilMs: number;
  retainedUnderPolicy: boolean;
  permanentlyDeleted?: boolean;
  updatedAt?: any;
}

export interface RetentionPolicyConfig {
  id: 'default';
  storyRetentionDays: number;
  softDeletedCommentRetentionDays: number;
  autoBackupOnUpload: boolean;
  enableStoryBackupArchival: boolean;
  preventDeleteIfSoleCopy: boolean;
  requireSnapshotBeforeRecovery: boolean;
  quotaWarnPct70: number;
  quotaWarnPct85: number;
  quotaCriticalPct95: number;
  updatedBy?: string;
  updatedAt?: any;
}

export interface BackupAuditLogEntry {
  id: string;
  actorUid: string;
  actorEmail?: string;
  action:
    | 'provider_configured'
    | 'provider_tested'
    | 'upload_registered'
    | 'backup_completed'
    | 'backup_failed'
    | 'backup_retried'
    | 'integrity_verified'
    | 'integrity_mismatch'
    | 'story_archived_expired'
    | 'story_purged'
    | 'comment_soft_deleted'
    | 'comment_restored'
    | 'comment_purged'
    | 'db_manifest_exported'
    | 'db_manifest_validated'
    | 'db_manifest_restored'
    | 'recovery_executed'
    | 'retention_updated'
    | 'delete_blocked_sole_copy';
  targetType: string;
  targetId: string;
  summary: string;
  details?: Record<string, string | number | boolean>;
  createdAt?: any;
}

export interface RecoveryOperationRecord {
  id: string;
  triggeredByUid: string;
  sourceBackupProvider: StorageProviderId;
  targetPrimaryProvider: StorageProviderId;
  dryRun: boolean;
  preRecoverySnapshotId?: string;
  totalEligible: number;
  recoveredCount: number;
  skippedCount: number;
  failedCount: number;
  integrityVerifiedCount: number;
  status: 'running' | 'completed' | 'partial' | 'failed';
  notes?: string;
  startedAtIso: string;
  completedAtIso?: string;
  createdAt?: any;
}

export interface DatabaseManifestExport {
  schemaVersion: 'bana-manifest-v1';
  platform: 'BANA';
  projectId: string;
  exportedAtIso: string;
  exportedByUid: string;
  excludedSensitiveFields: string[];
  recordCounts: Record<string, number>;
  checksumSha256: string;
  collections: {
    usersPublic: Record<string, unknown>[];
    posts: Record<string, unknown>[];
    reels: Record<string, unknown>[];
    stories: Record<string, unknown>[];
    storyBackups: Record<string, unknown>[];
    storyReplies: Record<string, unknown>[];
    comments: Record<string, unknown>[];
    voiceComments: Record<string, unknown>[];
    mediaAssets: Record<string, unknown>[];
    backupJobs: Record<string, unknown>[];
    communities: Record<string, unknown>[];
    marketplaceListings: Record<string, unknown>[];
    storageProviders: Record<string, unknown>[];
    retentionSettings: Record<string, unknown>[];
  };
}

export interface QuotaThresholdAlert {
  providerId: StorageProviderId;
  label: string;
  usedBytes: number;
  freeQuotaBytes: number;
  utilizationPct: number;
  severity: 'ok' | 'warning_70' | 'high_85' | 'critical_95';
  message: string;
}
