export type ApiProviderCategory =
  | 'voice_video_calling'
  | 'group_calling'
  | 'screen_sharing'
  | 'realtime_messaging'
  | 'push_notifications'
  | 'file_media_storage'
  | 'video_processing';

export type ApiProviderTier = 'free' | 'open_source' | 'paid';

export type ApiConnectionStatus = 'connected' | 'unconfigured' | 'degraded' | 'error' | 'not_tested';

export interface ApiProviderConfig {
  id: string;
  category: ApiProviderCategory;
  providerKey: string;
  name: string;
  tier: ApiProviderTier;
  requiresBillingApproval: boolean;
  billingApprovedByAdmin: boolean;
  billingApprovedAt?: string;
  enabled: boolean;
  isActive: boolean;
  endpointUrl?: string;
  publicAppId?: string;
  region?: string;
  requiredEnvKeys: string[];
  docsNote: string;
  connectionStatus: ApiConnectionStatus;
  configStatus: 'ready' | 'missing_credentials' | 'pending_approval';
  lastTestedAt?: string;
  lastTestMessage?: string;
  monthlyQuotaLabel: string;
  usageCount: number;
  estimatedCostUsd: number;
  updatedBy?: string;
  updatedAt?: any;
}

export interface ApiActiveCategorySelection {
  category: ApiProviderCategory;
  activeProviderId: string;
  activeProviderKey: string;
  /** Prompt 12: provider that was active before the last switch; used by the Rollback action. */
  previousActiveProviderId?: string;
  updatedBy?: string;
  updatedAt?: any;
}

export interface ApiUsageRecord {
  id: string;
  category: ApiProviderCategory;
  providerId: string;
  operation: string;
  requestsCount: number;
  successCount: number;
  errorCount: number;
  bandwidthMb: number;
  estimatedCostUsd: number;
  periodKey: string;
  createdAt?: any;
}

export interface ApiErrorLog {
  id: string;
  category: ApiProviderCategory;
  providerId: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  endpoint?: string;
  actorUid?: string;
  createdAt?: any;
}

export const API_CATEGORY_LABELS: Record<
  ApiProviderCategory,
  { title: string; subtitle: string }
> = {
  voice_video_calling: {
    title: 'Voice & Video Calling',
    subtitle: '1-to-1 audio & video real-time session transport',
  },
  group_calling: {
    title: 'Group Calling',
    subtitle: 'Multi-participant rooms, SFU routing, and mesh fallback',
  },
  screen_sharing: {
    title: 'Screen Sharing',
    subtitle: 'Browser tab, window, and desktop capture tracks',
  },
  realtime_messaging: {
    title: 'Realtime Messaging',
    subtitle: 'Instant chat delivery, typing indicators, and presence',
  },
  push_notifications: {
    title: 'Push Notifications',
    subtitle: 'Incoming call rings, unread DM alerts, and web push',
  },
  file_media_storage: {
    title: 'File & Media Storage',
    subtitle: 'Attachments, voice messages, photos, and videos',
  },
  video_processing: {
    title: 'Video Processing',
    subtitle: 'Transcoding, poster thumbnails, and adaptive HLS streaming',
  },
};

export const DEFAULT_API_PROVIDERS_CATALOG: Omit<ApiProviderConfig, 'updatedAt'>[] = [
  // 1. Voice & Video Calling
  {
    id: 'voice_video_calling__webrtc_builtin',
    category: 'voice_video_calling',
    providerKey: 'webrtc_builtin',
    name: 'Built-in WebRTC + Public STUN / Self-Hosted Coturn TURN',
    tier: 'free',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: true,
    endpointUrl: 'stun:stun.l.google.com:19302',
    requiredEnvKeys: ['TURN_SHARED_SECRET (optional)', 'TURN_URLS (optional)'],
    docsNote: 'Zero paid APIs required. P2P audio/video via STUN + optional self-hosted Coturn TURN.',
    connectionStatus: 'connected',
    configStatus: 'ready',
    monthlyQuotaLabel: 'No platform fee. P2P uses participants\' bandwidth; TURN relay limited by your TURN host',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'voice_video_calling__livekit_oss',
    category: 'voice_video_calling',
    providerKey: 'livekit_oss',
    name: 'LiveKit Open-Source SFU (Self-Hosted or Cloud Free Tier)',
    tier: 'open_source',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: false,
    endpointUrl: '',
    requiredEnvKeys: ['LIVEKIT_WS_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
    docsNote: 'Open-source SFU media server. Tokens minted securely inside backend/.',
    connectionStatus: 'not_tested',
    configStatus: 'missing_credentials',
    monthlyQuotaLabel: 'Self-hosted: no license fee, your server cost. LiveKit Cloud free-tier limits apply (verify)',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'voice_video_calling__agora',
    category: 'voice_video_calling',
    providerKey: 'agora',
    name: 'Agora RTC',
    tier: 'paid',
    requiresBillingApproval: true,
    billingApprovedByAdmin: false,
    enabled: false,
    isActive: false,
    requiredEnvKeys: ['AGORA_APP_ID', 'AGORA_APP_CERTIFICATE'],
    docsNote: 'Managed global RTC (10k free min/month, paid overage). Requires explicit Admin approval.',
    connectionStatus: 'unconfigured',
    configStatus: 'pending_approval',
    monthlyQuotaLabel: '10,000 free min / paid overage',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'voice_video_calling__100ms',
    category: 'voice_video_calling',
    providerKey: '100ms',
    name: '100ms Live Video API',
    tier: 'paid',
    requiresBillingApproval: true,
    billingApprovedByAdmin: false,
    enabled: false,
    isActive: false,
    requiredEnvKeys: ['HMS_ACCESS_KEY', 'HMS_APP_SECRET', 'HMS_TEMPLATE_ID'],
    docsNote: 'Managed WebRTC SFU room API. Requires explicit Admin approval.',
    connectionStatus: 'unconfigured',
    configStatus: 'pending_approval',
    monthlyQuotaLabel: '10,000 free min / paid overage',
    usageCount: 0,
    estimatedCostUsd: 0,
  },

  // 2. Group Calling
  {
    id: 'group_calling__webrtc_builtin',
    category: 'group_calling',
    providerKey: 'webrtc_builtin',
    name: 'Built-in WebRTC Multi-Peer Mesh + WebSocket Relay',
    tier: 'free',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: true,
    endpointUrl: '',
    requiredEnvKeys: ['VITE_BACKEND_URL (optional WebSocket)'],
    docsNote: 'Zero paid services. Ideal for small groups (2–8 participants). Configurable limit.',
    connectionStatus: 'connected',
    configStatus: 'ready',
    monthlyQuotaLabel: 'Up to 8 mesh peers recommended',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'group_calling__livekit_oss',
    category: 'group_calling',
    providerKey: 'livekit_oss',
    name: 'LiveKit Open-Source SFU Group Rooms',
    tier: 'open_source',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: false,
    requiredEnvKeys: ['LIVEKIT_WS_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
    docsNote: 'Scales group calls beyond mesh limits using Selective Forwarding Unit.',
    connectionStatus: 'not_tested',
    configStatus: 'missing_credentials',
    monthlyQuotaLabel: 'Depends on your SFU server capacity (no hard cap in BANA)',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'group_calling__agora',
    category: 'group_calling',
    providerKey: 'agora',
    name: 'Agora Group RTC',
    tier: 'paid',
    requiresBillingApproval: true,
    billingApprovedByAdmin: false,
    enabled: false,
    isActive: false,
    requiredEnvKeys: ['AGORA_APP_ID', 'AGORA_APP_CERTIFICATE'],
    docsNote: 'Requires explicit Admin billing approval before activation.',
    connectionStatus: 'unconfigured',
    configStatus: 'pending_approval',
    monthlyQuotaLabel: 'Pay-per-minute',
    usageCount: 0,
    estimatedCostUsd: 0,
  },

  // 3. Screen Sharing
  {
    id: 'screen_sharing__browser_webrtc',
    category: 'screen_sharing',
    providerKey: 'browser_webrtc',
    name: 'Native Browser getDisplayMedia() + WebRTC Track Replace',
    tier: 'free',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: true,
    requiredEnvKeys: [],
    docsNote: 'Standard W3C Screen Capture API for tab, window, and screen sharing.',
    connectionStatus: 'connected',
    configStatus: 'ready',
    monthlyQuotaLabel: 'No platform fee. Limited by device and bandwidth',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'screen_sharing__livekit_screen',
    category: 'screen_sharing',
    providerKey: 'livekit_screen',
    name: 'LiveKit Simulcast Screen Track',
    tier: 'open_source',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: false,
    requiredEnvKeys: ['LIVEKIT_WS_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'],
    docsNote: 'High-bitrate simulcast screen sharing via LiveKit SFU.',
    connectionStatus: 'not_tested',
    configStatus: 'missing_credentials',
    monthlyQuotaLabel: 'Self-hosted OSS',
    usageCount: 0,
    estimatedCostUsd: 0,
  },

  // 4. Realtime Messaging
  {
    id: 'realtime_messaging__firestore_ws',
    category: 'realtime_messaging',
    providerKey: 'firestore_ws',
    name: 'Firestore Realtime + Render WebSocket Signaling Bridge',
    tier: 'free',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: true,
    requiredEnvKeys: ['VITE_BACKEND_URL (optional WebSocket relay)'],
    docsNote: 'Persistent Firestore chats paired with low-latency Express/ws presence & typing.',
    connectionStatus: 'connected',
    configStatus: 'ready',
    monthlyQuotaLabel: 'Spark 50k reads/day + Render Free WS',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'realtime_messaging__supabase_realtime',
    category: 'realtime_messaging',
    providerKey: 'supabase_realtime',
    name: 'Supabase PostgreSQL + Realtime Channels',
    tier: 'open_source',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: false,
    requiredEnvKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    docsNote: 'PostgreSQL Realtime CDC + Row Level Security via database/supabase migrations.',
    connectionStatus: 'not_tested',
    configStatus: 'missing_credentials',
    monthlyQuotaLabel: 'Supabase Free 500MB DB / 200 conc.',
    usageCount: 0,
    estimatedCostUsd: 0,
  },

  // 5. Push Notifications
  {
    id: 'push_notifications__inapp_browser',
    category: 'push_notifications',
    providerKey: 'inapp_browser',
    name: 'Firestore Real-Time Notifications + Browser Web Notifications API',
    tier: 'free',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: true,
    requiredEnvKeys: [],
    docsNote: 'Zero paid services. Real-time in-app inbox + desktop notification alerts when permitted.',
    connectionStatus: 'connected',
    configStatus: 'ready',
    monthlyQuotaLabel: 'Reads/writes count against Spark Firestore quota',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'push_notifications__web_push_vapid',
    category: 'push_notifications',
    providerKey: 'web_push_vapid',
    name: 'Standard Web Push (VAPID via backend/)',
    tier: 'open_source',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: false,
    requiredEnvKeys: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
    docsNote: 'Open-standard W3C Push API with zero vendor lock-in.',
    connectionStatus: 'not_tested',
    configStatus: 'missing_credentials',
    monthlyQuotaLabel: 'Push service free. Backend hosting for VAPID may cost',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'push_notifications__fcm',
    category: 'push_notifications',
    providerKey: 'fcm',
    name: 'Firebase Cloud Messaging (FCM)',
    tier: 'free',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: false,
    requiredEnvKeys: ['FIREBASE_PROJECT_ID', 'GOOGLE_APPLICATION_CREDENTIALS (backend)'],
    docsNote: 'Push dispatch from Express backend using Firebase Admin/Service Account.',
    connectionStatus: 'not_tested',
    configStatus: 'missing_credentials',
    monthlyQuotaLabel: 'FCM has no platform fee. Rate limits apply',
    usageCount: 0,
    estimatedCostUsd: 0,
  },

  // 6. File & Media Storage
  {
    id: 'file_media_storage__cloudflare_r2',
    category: 'file_media_storage',
    providerKey: 'cloudflare_r2',
    name: 'Cloudflare R2 (via Media Broker / Backend)',
    tier: 'free',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: true,
    requiredEnvKeys: ['VITE_MEDIA_BROKER_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'],
    docsNote: '10 GB/month free storage with zero egress fees. Presigned uploads via Worker/Backend.',
    connectionStatus: 'not_tested',
    configStatus: 'ready',
    monthlyQuotaLabel: '10 GB free storage, $0 egress',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'file_media_storage__backblaze_b2',
    category: 'file_media_storage',
    providerKey: 'backblaze_b2',
    name: 'Backblaze B2 (Backup & S3 Adapter)',
    tier: 'free',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: false,
    requiredEnvKeys: ['B2_KEY_ID', 'B2_APPLICATION_KEY', 'B2_BUCKET_NAME'],
    docsNote: '10 GB free S3-compatible object storage & automated backup replica.',
    connectionStatus: 'not_tested',
    configStatus: 'missing_credentials',
    monthlyQuotaLabel: '10 GB free',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'file_media_storage__supabase_storage',
    category: 'file_media_storage',
    providerKey: 'supabase_storage',
    name: 'Supabase Storage Buckets',
    tier: 'open_source',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: false,
    requiredEnvKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_STORAGE_BUCKET'],
    docsNote: 'Open-source object storage with bucket RLS policies in database/supabase.',
    connectionStatus: 'not_tested',
    configStatus: 'missing_credentials',
    monthlyQuotaLabel: '1 GB free Supabase tier',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'file_media_storage__gcs',
    category: 'file_media_storage',
    providerKey: 'gcs',
    name: 'Google Cloud Storage',
    tier: 'paid',
    requiresBillingApproval: true,
    billingApprovedByAdmin: false,
    enabled: false,
    isActive: false,
    requiredEnvKeys: ['GCS_BUCKET', 'GOOGLE_APPLICATION_CREDENTIALS'],
    docsNote: 'Requires Google Cloud billing & Admin approval.',
    connectionStatus: 'unconfigured',
    configStatus: 'pending_approval',
    monthlyQuotaLabel: 'Pay-as-you-go',
    usageCount: 0,
    estimatedCostUsd: 0,
  },

  // 7. Video Processing
  {
    id: 'video_processing__browser_progressive',
    category: 'video_processing',
    providerKey: 'browser_progressive',
    name: 'Direct Progressive MP4 / WebM + Client Poster Extraction',
    tier: 'free',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: true,
    requiredEnvKeys: [],
    docsNote: 'Zero transcoding spend. Validates codecs and extracts poster frames client-side.',
    connectionStatus: 'connected',
    configStatus: 'ready',
    monthlyQuotaLabel: 'No platform fee. Bandwidth depends on storage provider',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'video_processing__ffmpeg_worker',
    category: 'video_processing',
    providerKey: 'ffmpeg_worker',
    name: 'Self-Hosted FFmpeg HLS Worker',
    tier: 'open_source',
    requiresBillingApproval: false,
    billingApprovedByAdmin: true,
    enabled: true,
    isActive: false,
    requiredEnvKeys: ['FFMPEG_WORKER_URL', 'FFMPEG_WORKER_SECRET'],
    docsNote: 'Generates adaptive HLS (.m3u8) renditions on your own VPS/container.',
    connectionStatus: 'not_tested',
    configStatus: 'missing_credentials',
    monthlyQuotaLabel: 'Self-hosted compute',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
  {
    id: 'video_processing__cloudflare_stream',
    category: 'video_processing',
    providerKey: 'cloudflare_stream',
    name: 'Cloudflare Stream (Paid Upgrade)',
    tier: 'paid',
    requiresBillingApproval: true,
    billingApprovedByAdmin: false,
    enabled: false,
    isActive: false,
    requiredEnvKeys: ['CF_ACCOUNT_ID', 'CF_STREAM_API_TOKEN'],
    docsNote: 'Managed HLS encoding ($5/1,000 min). Blocked unless Admin explicitly approves.',
    connectionStatus: 'unconfigured',
    configStatus: 'pending_approval',
    monthlyQuotaLabel: '$5 / 1,000 min stored',
    usageCount: 0,
    estimatedCostUsd: 0,
  },
];
