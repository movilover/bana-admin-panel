export type ThemeMode = 'light' | 'dark' | 'system';
export type MessengerThemeMode = 'light' | 'dark' | 'match';

export type PostVisibility = 'public' | 'followers' | 'friends' | 'only_me';
export type PostType = 'text' | 'image' | 'gallery' | 'video' | 'voice' | 'poll' | 'shared';
export type MarketCategory =
  | 'Fashion'
  | 'Electronics'
  | 'Home & Living'
  | 'Beauty'
  | 'Accessories'
  | 'Sports'
  | 'Books'
  | 'Handmade Products'
  | 'Vehicles'
  | 'Services'
  | 'Other Products'
  | 'Other'
  | string;

export type AdminRoleType =
  | 'super_admin'
  | 'admin'
  | 'moderator'
  | 'support_staff'
  | 'finance_manager'
  | 'ad_manager'
  | 'content_manager'
  | 'support_manager';

export type ProfileAccent = 'blue' | 'slate' | 'emerald' | 'amber' | 'rose';
export type FriendRequestPolicy = 'everyone' | 'followers' | 'friends_of_friends' | 'nobody';
export type ProfileListVisibility = 'everyone' | 'friends' | 'only_me';
export type FollowerListVisibility = 'everyone' | 'followers' | 'only_me';

export interface BanaUser {
  uid: string;
  username: string;
  displayName: string;
  bio?: string;
  avatarUrl?: string;
  coverUrl?: string;
  location?: string;
  website?: string;
  creatorCategory?: string;
  interests?: DiscoveryCategory[];
  onboardingCompleted?: boolean;
  isVerified: boolean;
  verificationType?: 'identity' | 'organization' | 'paid';
  lastVerificationAuditId?: string;
  isCreator: boolean;
  isMinor?: boolean;
  isPrivateAccount?: boolean;
  accountStatus: 'active' | 'suspended' | 'banned';
  accountRestrictionNote?: string;
  followersCount: number;
  followingCount: number;
  friendsCount?: number;
  postsCount?: number;
  paidListingQuota?: number;
  whoCanFollow?: 'everyone' | 'approval';
  whoCanFriendRequest?: FriendRequestPolicy;
  /** Public mirror of the 'Suggest me to others' setting (true = opted out of Friend Suggestions). */
  suggestionsOptOut?: boolean;
  whoCanMessage?: 'everyone' | 'followers' | 'friends' | 'nobody';
  whoCanCall?: 'everyone' | 'followers' | 'friends' | 'nobody';
  whoCanViewFriends?: ProfileListVisibility;
  whoCanViewFollowers?: FollowerListVisibility;
  showOnlineStatus?: boolean;
  showPersonalInfo?: boolean;
  showLocation?: boolean;
  profileLayout?: 'list' | 'grid';
  profileAccent?: ProfileAccent;
  pinnedPostId?: string;
  featuredPostIds?: string[];
  highlights?: string[];
  lastActiveAt?: number;
  messagingRestricted?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface PlatformSettings {
  platformName: string;
  tagline: string;
  websiteTitle?: string;
  websiteDescription?: string;
  logoUrl?: string;
  faviconUrl?: string;
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  registrationOpen: boolean;
  allowGoogleSignIn?: boolean;
  allowEmailPasswordSignIn?: boolean;
  requireEmailVerification?: boolean;
  enableReels: boolean;
  enableMarketplace: boolean;
  enableCalling: boolean;
  enableMessaging?: boolean;
  enableCommunities?: boolean;
  enableMonetization?: boolean;
  enableAds?: boolean;
  defaultPostVisibility?: PostVisibility;
  defaultMessagePrivacy?: 'everyone' | 'followers' | 'friends' | 'nobody';
  defaultAccountPrivate?: boolean;
  defaultEmailNotifications?: boolean;
  defaultPushNotifications?: boolean;
  contentPolicyText?: string;
  communityGuidelinesText?: string;
  announcementEnabled?: boolean;
  announcementMessage?: string;
  announcementSeverity?: 'info' | 'warning' | 'alert';
  updatedAt?: any;
}

export interface MarketplacePolicySettings {
  id: 'marketplace';
  requireListingApproval: boolean;
  freeListingsLimit: number;
  requireSellerVerificationForStores: boolean;
  allowedCurrencies: string[];
  buyerDisputeWindowDays: number;
  escrowHoldDays: number;
  policySummary: string;
  updatedBy?: string;
  updatedAt?: any;
}

export interface CallingServiceSettings {
  webrtcEnabled: boolean;
  allowVoiceCalls: boolean;
  allowVideoCalls: boolean;
  allowGroupCalls?: boolean;
  allowScreenSharing?: boolean;
  maxGroupCallParticipants?: number;
  activeCallingProvider?: string;
  stunServers: string[];
  turnRelayHint?: string;
  turnProvider?: 'none' | 'coturn' | 'metered' | 'twilio';
  maxCallDurationMinutes?: number;
  updatedAt?: any;
}

export type ChatBubbleStyle = 'classic' | 'minimal' | 'soft';

export interface BanaUserSettings {
  uid: string;
  email?: string;
  birthYear?: number;
  themeMode: ThemeMode;
  messengerTheme: MessengerThemeMode;
  chatBubbleStyle?: ChatBubbleStyle;
  messengerSoundEnabled?: boolean;
  callNotificationsEnabled?: boolean;
  isPrivateAccount?: boolean;
  whoCanSeePosts: PostVisibility;
  whoCanMessage: 'everyone' | 'followers' | 'friends' | 'nobody';
  whoCanCall?: 'everyone' | 'followers' | 'friends' | 'nobody';
  whoCanComment: 'everyone' | 'followers' | 'friends';
  whoCanFollow: 'everyone' | 'approval';
  whoCanFriendRequest?: FriendRequestPolicy;
  whoCanViewFriends?: ProfileListVisibility;
  whoCanViewFollowers?: FollowerListVisibility;
  showOnlineStatus: boolean;
  showReadReceipts: boolean;
  showPersonalInfo: boolean;
  showLocation?: boolean;
  notificationPrefs: {
    likes: boolean;
    comments: boolean;
    follows: boolean;
    friendRequests?: boolean;
    verification?: boolean;
    messages: boolean;
    communities: boolean;
    marketplace: boolean;
    monetization: boolean;
  };
  interests?: DiscoveryCategory[];
  interestWeights?: Record<string, number>;
  hiddenCreatorIds?: string[];
  dismissedPostIds?: string[];
  dismissedSuggestionIds?: string[];
  /** false = do not show me as a suggestion to other people (default true). */
  allowFriendSuggestions?: boolean;
  updatedAt?: any;
}

export type DiscoveryCategory =
  | 'Technology'
  | 'Entertainment'
  | 'Education'
  | 'Business'
  | 'Sports'
  | 'Lifestyle'
  | 'Travel'
  | 'Gaming'
  | 'News & Community';

export const DISCOVERY_CATEGORIES: DiscoveryCategory[] = [
  'Technology',
  'Entertainment',
  'Education',
  'Business',
  'Sports',
  'Lifestyle',
  'Travel',
  'Gaming',
  'News & Community',
];

export interface PollOption {
  id: string;
  label: string;
  votes: number;
}

export interface BanaPost {
  id: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatar?: string;
  authorVerified?: boolean;
  type: PostType;
  category?: DiscoveryCategory;
  content: string;
  mediaUrls?: string[];
  thumbnailUrl?: string;
  audioUrl?: string;
  audioDuration?: number;
  /** True duration (seconds) of a video post, measured from the uploaded file. Absent on legacy posts. */
  videoDurationSeconds?: number;
  pollQuestion?: string;
  pollOptions?: PollOption[];
  pollVoters?: Record<string, string>;
  hashtags?: string[];
  taggedUsernames?: string[];
  locationName?: string;
  communityId?: string;
  communityName?: string;
  sharedPostId?: string;
  sharedPostSnapshot?: {
    authorName: string;
    authorUsername: string;
    content: string;
    mediaUrl?: string;
  };
  visibility: PostVisibility;
  status: 'published' | 'draft' | 'removed';
  mediaAssetId?: string;
  storageProvider?: string;
  backupUrl?: string;
  checksumSha256?: string;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  viewsCount?: number;
  reactionsSummary?: Record<string, number>;
  isBoosted?: boolean;
  boostPackageName?: string;
  boostReachTarget?: number;
  boostExpiresAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

export interface ReelQualityVariant {
  label: string;
  url: string;
  width?: number;
  height?: number;
}

export interface BanaReel {
  id: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatar?: string;
  authorVerified?: boolean;
  title?: string;
  videoUrl: string;
  backupVideoUrl?: string;
  thumbnailUrl?: string;
  captionsVttUrl?: string;
  hlsManifestUrl?: string;
  mediaAssetId?: string;
  storageProvider?: string;
  objectKey?: string;
  backupProvider?: string;
  backupObjectKey?: string;
  checksumSha256?: string;
  qualityVariants?: ReelQualityVariant[];
  aspectRatio?: '9:16' | '16:9' | '1:1' | '4:5';
  processingStatus?:
    | 'uploading'
    | 'upload_failed'
    | 'uploaded'
    | 'processing'
    | 'ready'
    | 'backup_pending'
    | 'backup_complete'
    | 'recovery_required'
    | 'failed';
  fileSizeBytes?: number;
  mimeType?: string;
  caption: string;
  description?: string;
  category?: DiscoveryCategory;
  soundName?: string;
  hashtags?: string[];
  durationSeconds?: number;
  visibility: 'public' | 'followers' | 'only_me';
  status: 'active' | 'draft' | 'removed';
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount?: number;
  viewsCount: number;
  reactionsSummary?: Record<string, number>;
  createdAt?: any;
  updatedAt?: any;
}

export interface BanaStory {
  id: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatar?: string;
  mediaUrl?: string;
  backupMediaUrl?: string;
  mediaType: 'image' | 'video' | 'text';
  mediaAssetId?: string;
  storageProvider?: string;
  objectKey?: string;
  checksumSha256?: string;
  caption?: string;
  bgGradient?: string;
  visibility: 'public' | 'followers' | 'friends';
  status?: 'active' | 'expired' | 'archived' | 'deleted';
  viewsCount: number;
  repliesCount?: number;
  createdAt?: any;
  expiresAt?: any;
}

export interface BanaStoryReply {
  id: string;
  storyId: string;
  storyAuthorId: string;
  senderId: string;
  senderUsername: string;
  senderName: string;
  senderAvatar?: string;
  message: string;
  createdAt?: any;
}

export interface SavedItemRecord {
  id: string;
  userId: string;
  postId: string;
  targetType?: 'post' | 'photo' | 'video' | 'reel';
  collectionName?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface RecentSearchItem {
  id: string;
  userId: string;
  query: string;
  createdAt?: any;
}

export interface BanaComment {
  id: string;
  targetType: 'post' | 'reel';
  targetId: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  parentCommentId?: string;
  replyToUsername?: string;
  likesCount?: number;
  reactionSummary?: Record<string, number>;
  moderationStatus?: 'active' | 'flagged' | 'hidden' | 'removed';
  deletionStatus?: 'active' | 'soft_deleted' | 'permanently_deleted';
  deletedBy?: string;
  deletedAt?: any;
  clientMutationId?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface BanaVoiceComment {
  id: string;
  targetType: 'post' | 'reel';
  targetId: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatar?: string;
  audioUrl: string;
  backupAudioUrl?: string;
  mediaAssetId?: string;
  durationSeconds: number;
  waveform: number[];
  moderationStatus?: 'active' | 'flagged' | 'hidden' | 'removed';
  deletionStatus?: 'active' | 'soft_deleted';
  createdAt?: any;
}

export interface BanaConversation {
  id: string;
  participantIds: string[];
  adminIds?: string[];
  participantMeta?: Record<
    string,
    {
      displayName: string;
      username: string;
      avatarUrl?: string;
    }
  >;
  isGroup: boolean;
  groupName?: string;
  groupDescription?: string;
  groupAvatar?: string;
  lastMessageText?: string;
  lastMessageSenderId?: string;
  isRequest?: boolean;
  requestRecipientId?: string;
  mutedBy?: string[];
  archivedBy?: string[];
  unreadCounts?: Record<string, number>;
  typingUsers?: Record<string, number>;
  updatedAt?: any;
  createdAt?: any;
}

export interface BanaMessage {
  id: string;
  conversationId: string;
  senderId: string;
  type: 'text' | 'image' | 'video' | 'voice' | 'audio' | 'file' | 'shared_post' | 'shared_reel';
  text?: string;
  mediaUrl?: string;
  fileName?: string;
  fileSize?: number;
  audioDuration?: number;
  audioWaveform?: number[];
  sharedTargetId?: string;
  sharedSnapshot?: {
    targetType: 'post' | 'reel';
    authorName: string;
    authorUsername: string;
    content: string;
    mediaUrl?: string;
  };
  replyToId?: string;
  replyPreview?: string;
  reactions?: Record<string, string[]>;
  deliveredTo?: string[];
  readBy?: string[];
  isEdited?: boolean;
  isDeleted?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface BanaCommunity {
  id: string;
  name: string;
  slug: string;
  description: string;
  category: string;
  district?: string;
  coverUrl?: string;
  avatarUrl?: string;
  creatorId: string;
  moderatorIds?: string[];
  restrictedUserIds?: string[];
  privacy: 'public' | 'private';
  requiresApproval: boolean;
  rules: string[];
  announcement?: string;
  pinnedPostId?: string;
  chatConversationId?: string;
  membersCount: number;
  status: 'active' | 'suspended';
  createdAt?: any;
  updatedAt?: any;
}

export interface BanaMarketListing {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerUsername: string;
  sellerAvatar?: string;
  storeId?: string;
  storeName?: string;
  title: string;
  description: string;
  price: number;
  currency: 'BDT' | 'USD' | 'EUR' | 'GBP';
  category: MarketCategory;
  subcategory?: string;
  condition: 'New' | 'Like New' | 'Used' | 'Refurbished';
  quantity?: number;
  soldCount?: number;
  deliveryOptions?: string[];
  deliveryFee?: number;
  location: string;
  imageUrls: string[];
  status: 'active' | 'draft' | 'pending_review' | 'out_of_stock' | 'sold' | 'rejected';
  ratingAvg?: number;
  reviewsCount?: number;
  viewsCount: number;
  savesCount: number;
  isBoosted?: boolean;
  boostExpiresAt?: any;
  boostReachTarget?: number;
  createdAt?: any;
  updatedAt?: any;
}

export type BanaProduct = BanaMarketListing;

export interface BanaNotification {
  id: string;
  recipientId: string;
  actorId: string;
  actorName: string;
  actorAvatar?: string;
  type:
    | 'like'
    | 'comment'
    | 'reply'
    | 'follow'
    | 'follow_request'
    | 'follow_accepted'
    | 'friend_request'
    | 'friend_accepted'
    | 'verification'
    | 'message'
    | 'call'
    | 'mention'
    | 'community'
    | 'marketplace'
    | 'monetization'
    | 'ad';
  title: string;
  body: string;
  linkUrl: string;
  dedupeKey?: string;
  isRead: boolean;
  createdAt?: any;
}

export interface CreatorApplicationHistoryEntry {
  status: 'pending' | 'approved' | 'rejected' | 'appealed' | 'needs_info' | 'suspended' | 'restored';
  note?: string;
  actorUid?: string;
  at: string;
}

export interface CreatorApplication {
  id: string;
  uid: string;
  username: string;
  displayName?: string;
  followerCountAtApply: number;
  country: string;
  payoutCategory: string;
  status: 'pending' | 'approved' | 'rejected' | 'appealed' | 'needs_info' | 'suspended';
  rejectionReason?: string;
  adminNote?: string;
  appealNote?: string;
  userResponseNote?: string;
  originalContentAttested?: boolean;
  policiesAccepted?: boolean;
  regionalComplianceAttested?: boolean;
  reviewedBy?: string;
  history?: CreatorApplicationHistoryEntry[];
  createdAt?: any;
  updatedAt?: any;
}

export interface MonetizationPolicy {
  id: string;
  monetizationEnabled: boolean;
  creatorSharePct: number;
  platformSharePct: number;
  minFollowers: number;
  minPayoutUsd: number;
  qualifiedViewMinSeconds: number;
  requireEmailVerified: boolean;
  requireOriginalContent: boolean;
  requireAdultAge: boolean;
  eligibleRegions: string[];
  payoutMethodsEnabled: string[];
  policySummary: string;
  adPoolCpmUsd?: number;
  /** Prompt 08: admin-editable program terms & content requirements (no income is ever promised). */
  programTerms?: string;
  contentRequirements?: string;
  /** Monotonic version; bumped on every saved change. Historical earnings keep the version they were computed under. */
  policyVersion?: number;
  updatedBy?: string;
  updatedAt?: any;
}

/** Immutable record of one financial/ads policy change (before/after snapshot). Never edited or deleted. */
export interface PolicyChangeRecord {
  id: string;
  policyType: 'monetization' | 'advertising';
  policyId: string;
  version: number;
  changedBy: string;
  changedByName?: string;
  changedFields: string[];
  before: Record<string, any>;
  after: Record<string, any>;
  reason: string;
  createdAt?: any;
}

export interface SellerApplication {
  id: string; // == applicant uid (one application per user)
  uid: string;
  username: string;
  displayName: string;
  storeName: string;
  storeDescription: string;
  district: string;
  productCategories: string[];
  contactPhone?: string;
  contactEmail?: string;
  businessType: 'individual' | 'registered_business';
  acceptedSellerPolicy: boolean;
  status: 'pending' | 'approved' | 'rejected';
  adminNote?: string;
  reviewedBy?: string;
  reviewedAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

export interface CreatorEligibilityRecord {
  uid: string;
  followersCount: number;
  requiredFollowers: number;
  isAdult: boolean;
  isEmailVerified: boolean;
  hasOriginalContent: boolean;
  isGoodStanding: boolean;
  regionEligible: boolean;
  policyCompliant: boolean;
  eligibleToApply: boolean;
  monetizationStatus:
    | 'not_eligible'
    | 'eligible'
    | 'pending'
    | 'needs_info'
    | 'approved'
    | 'rejected'
    | 'suspended';
  outstandingRequirements: string[];
  checkedAt?: any;
}

export type EarningSourceType =
  | 'video_ads'
  | 'reels_ads'
  | 'sponsored_content'
  | 'brand_campaign'
  | 'platform_program'
  | 'video_views'
  | 'content_engagement'
  | 'ad_rev_share'
  | 'adjustment';

export interface EarningEvent {
  id: string;
  uid: string;
  contentType: 'reel' | 'video' | 'post';
  contentId: string;
  contentTitle?: string;
  sourceType: EarningSourceType;
  qualifiedViews: number;
  watchSeconds: number;
  estimatedAmountUsd: number;
  confirmedAmountUsd: number;
  status: 'estimated' | 'confirmed' | 'pending' | 'adjusted';
  dedupeKey?: string;
  period: string;
  createdAt?: any;
}

export interface CreatorEarning {
  id: string;
  uid: string;
  sourceType: EarningSourceType;
  amountUsd: number;
  status: 'estimated' | 'confirmed' | 'pending' | 'approved' | 'paid' | 'adjusted';
  period: string;
  description: string;
  adjustmentReason?: string;
  adjustedBy?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface CreatorPayoutProfile {
  uid: string;
  preferredMethod: string;
  accountHolderName: string;
  accountIdentifierMasked: string;
  bankName?: string;
  branchName?: string;
  country: string;
  taxResidencyNote?: string;
  verifiedForPayouts: boolean;
  updatedAt?: any;
}

export interface PayoutRequest {
  id: string;
  uid: string;
  amountUsd: number;
  method: string;
  accountLabel: string;
  accountHolderName?: string;
  country: string;
  status: 'pending' | 'approved' | 'processing' | 'completed' | 'paid' | 'rejected';
  providerStatus?: 'manual_review' | 'provider_verified' | 'provider_unconfigured' | 'failed';
  transactionRef?: string;
  adminNote?: string;
  reviewedBy?: string;
  createdAt?: any;
  updatedAt?: any;
}

export type FinancialTransactionType =
  | 'earning_estimated'
  | 'earning_confirmed'
  | 'earning_adjustment'
  | 'payout_requested'
  | 'payout_completed'
  | 'payout_reversed'
  | 'ad_deposit'
  | 'ad_spend'
  | 'ad_refund';

export interface FinancialTransaction {
  id: string;
  uid: string;
  txType: FinancialTransactionType;
  direction: 'credit' | 'debit';
  amountUsd: number;
  currency: string;
  referenceType: string;
  referenceId: string;
  description: string;
  actorUid?: string;
  createdAt?: any;
}

export interface AdvertiserAccount {
  uid: string;
  businessName: string;
  contactEmail: string;
  website?: string;
  country: string;
  billingCurrency: 'USD' | 'BDT';
  status: 'active' | 'restricted' | 'suspended';
  restrictionNote?: string;
  walletBalanceUsd: number;
  lifetimeDepositUsd: number;
  lifetimeSpendUsd: number;
  verifiedAdvertiser: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export type AdCampaignType = 'sponsored_post' | 'sponsored_reel' | 'sponsored_video' | 'marketplace_promo';
export type AdObjective = 'reach' | 'traffic' | 'engagement' | 'catalog_sales';
export type AdPlacement = 'home_feed' | 'reels_feed' | 'marketplace';

export interface AdAudienceTargeting {
  districts: string[];
  language: string;
  minAge: number;
  interests: DiscoveryCategory[];
  categories: string[];
  minorExcluded: boolean;
}

export interface AdCreativeItem {
  id: string;
  advertiserId: string;
  campaignId?: string;
  title: string;
  headline: string;
  bodyText: string;
  ctaLabel: string;
  mediaUrl: string;
  mediaType: 'image' | 'video';
  destinationUrl: string;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  rejectionReason?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface AdCampaign {
  id: string;
  advertiserId: string;
  advertiserName?: string;
  campaignName: string;
  campaignType?: AdCampaignType;
  objective?: AdObjective;
  headline: string;
  bodyText: string;
  ctaLabel?: string;
  creativeUrl: string;
  creativeType: 'image' | 'video';
  creativeId?: string;
  destinationUrl: string;
  placements?: AdPlacement[];
  targeting?: AdAudienceTargeting;
  categoryTag?: string;
  dailyBudgetUsd: number;
  totalBudgetUsd: number;
  startDate: string;
  endDate: string;
  status: 'draft' | 'pending_review' | 'approved' | 'active' | 'paused' | 'rejected' | 'completed' | 'terminated';
  rejectionReason?: string;
  impressions: number;
  reachCount?: number;
  clicks: number;
  spentUsd: number;
  dailySpendDate?: string;
  dailySpentUsd?: number;
  minorSafeAttested: boolean;
  approvedBy?: string;
  terminatedAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

export interface AdImpressionRecord {
  id: string;
  campaignId: string;
  advertiserId?: string;
  placement: AdPlacement;
  viewerId?: string;
  sessionKey?: string;
  costChargedUsd?: number;
  dayKey?: string;
  createdAt?: any;
}

export interface AdClickRecord {
  id: string;
  campaignId: string;
  advertiserId?: string;
  placement: AdPlacement;
  viewerId?: string;
  sessionKey?: string;
  costChargedUsd?: number;
  dayKey?: string;
  createdAt?: any;
}

export interface AdPaymentRecord {
  id: string;
  advertiserId: string;
  campaignId?: string;
  amountUsd: number;
  currency: 'USD' | 'BDT';
  method: 'bkash' | 'nagad' | 'bank_transfer' | 'card_gateway';
  transactionRef: string;
  senderAccount?: string;
  providerVerified: boolean;
  status: 'awaiting_verification' | 'paid' | 'failed' | 'refunded';
  reviewedBy?: string;
  note?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface AdvertisingSettings {
  id?: string;
  adsEnabled: boolean;
  enabledPlacements: AdPlacement[];
  blockedCategories: string[];
  defaultCpmUsd: number;
  defaultCpcUsd: number;
  minDailyBudgetUsd: number;
  minTotalBudgetUsd: number;
  frequencyCapPerSession: number;
  requireManualReview: boolean;
  policyVersion?: number;
  updatedBy?: string;
  updatedAt?: any;
}

export interface BanaReport {
  id: string;
  reporterId: string;
  targetType: 'user' | 'post' | 'reel' | 'comment' | 'voice_comment' | 'message' | 'listing' | 'community' | 'ad';
  targetId: string;
  reason: string;
  details: string;
  status: 'pending' | 'reviewing' | 'resolved' | 'dismissed';
  resolutionNote?: string;
  createdAt?: any;
}

export interface BanaEvent {
  id: string;
  organizerId: string;
  organizerName: string;
  communityId?: string;
  communityName?: string;
  title: string;
  description: string;
  coverUrl?: string;
  isOnline?: boolean;
  onlineUrl?: string;
  announcement?: string;
  category: DiscoveryCategory;
  district: string;
  venue: string;
  eventDate: string;
  eventTime?: string;
  capacity: number;
  attendeesCount: number;
  interestedCount?: number;
  status: 'upcoming' | 'cancelled' | 'completed';
  createdAt?: any;
  updatedAt?: any;
}

export type ReactionType = 'like' | 'love' | 'haha' | 'wow' | 'sad' | 'angry';

export interface BoostPackage {
  id: string;
  name: string;
  packageType: 'boost_post' | 'marketplace_slot';
  priceBdt: number;
  priceUsd: number;
  durationDays: number;
  estimatedReach: number;
  listingSlots: number;
  description: string;
  isActive: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export interface PaymentBoostRequest {
  id: string;
  uid: string;
  username: string;
  userName: string;
  requestType: 'boost_post' | 'marketplace_slot';
  targetCollection?: 'posts' | 'marketplaceListings';
  targetId?: string;
  targetTitle?: string;
  packageId: string;
  packageName: string;
  amountBdt: number;
  amountUsd: number;
  durationDays: number;
  estimatedReach: number;
  listingSlots: number;
  paymentMethod: 'bKash' | 'Nagad' | 'Bank Transfer';
  senderNumber: string;
  transactionId: string;
  status: 'pending' | 'approved' | 'rejected';
  adminNote?: string;
  createdAt?: any;
  updatedAt?: any;
}

export const FREE_MARKETPLACE_POST_LIMIT = 3;

export const MARKET_CATEGORIES: MarketCategory[] = [
  'Fashion',
  'Electronics',
  'Home & Living',
  'Beauty',
  'Accessories',
  'Sports',
  'Books',
  'Handmade Products',
  'Other Products',
];

export interface ProductCategoryItem {
  id: string;
  name: string;
  slug: string;
  subcategories: string[];
  sortOrder: number;
  isActive: boolean;
  createdAt?: any;
  updatedAt?: any;
}

export const DEFAULT_PRODUCT_CATEGORIES: Omit<ProductCategoryItem, 'createdAt' | 'updatedAt'>[] = [
  { id: 'fashion', name: 'Fashion', slug: 'fashion', subcategories: ['Men', 'Women', 'Traditional & Sharee', 'Footwear'], sortOrder: 1, isActive: true },
  { id: 'electronics', name: 'Electronics', slug: 'electronics', subcategories: ['Phones & Tablets', 'Laptops & PC', 'Cameras & Audio', 'Gadgets'], sortOrder: 2, isActive: true },
  { id: 'home-living', name: 'Home & Living', slug: 'home-living', subcategories: ['Furniture', 'Decor', 'Kitchen', 'Lighting'], sortOrder: 3, isActive: true },
  { id: 'beauty', name: 'Beauty', slug: 'beauty', subcategories: ['Skincare', 'Fragrance', 'Haircare', 'Cosmetics'], sortOrder: 4, isActive: true },
  { id: 'accessories', name: 'Accessories', slug: 'accessories', subcategories: ['Watches', 'Bags', 'Eyewear', 'Jewelry'], sortOrder: 5, isActive: true },
  { id: 'sports', name: 'Sports', slug: 'sports', subcategories: ['Cricket & Football', 'Fitness', 'Cycling', 'Outdoor'], sortOrder: 6, isActive: true },
  { id: 'books', name: 'Books', slug: 'books', subcategories: ['Fiction', 'Academic', 'Tech & Business', 'Bengali Literature'], sortOrder: 7, isActive: true },
  { id: 'handmade', name: 'Handmade Products', slug: 'handmade-products', subcategories: ['Jamdani & Craft', 'Pottery', 'Art & Prints', 'Woodcraft'], sortOrder: 8, isActive: true },
  { id: 'other-products', name: 'Other Products', slug: 'other-products', subcategories: ['Collectibles', 'Office Supplies', 'General'], sortOrder: 9, isActive: true },
];

export interface BanaStore {
  id: string;
  ownerId: string;
  ownerUsername: string;
  ownerName: string;
  name: string;
  slug: string;
  description: string;
  logoUrl?: string;
  coverUrl?: string;
  district: string;
  contactPreference: 'messenger' | 'phone' | 'both';
  contactPhone?: string;
  contactEmail?: string;
  ratingAvg: number;
  reviewsCount: number;
  totalSales: number;
  status: 'active' | 'restricted' | 'suspended';
  restrictionNote?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface CartItem {
  productId: string;
  sellerId: string;
  storeId?: string;
  storeName?: string;
  title: string;
  price: number;
  currency: 'BDT' | 'USD' | 'EUR' | 'GBP';
  deliveryFee: number;
  quantity: number;
  imageUrl?: string;
  maxStock?: number;
}

export interface ShoppingCartDoc {
  uid: string;
  items: CartItem[];
  updatedAt?: any;
}

export interface WishlistItem {
  id: string;
  userId: string;
  productId: string;
  createdAt?: any;
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type OrderPaymentMethod = 'cod' | 'bkash' | 'nagad' | 'card_gateway';

export type OrderPaymentStatus =
  | 'pending_cod'
  | 'awaiting_verification'
  | 'paid'
  | 'failed'
  | 'refund_requested'
  | 'refunded';

export interface OrderShippingAddress {
  fullName: string;
  phone: string;
  district: string;
  addressLine: string;
  postalCode?: string;
  notes?: string;
}

export interface MarketplaceOrderItem {
  id: string;
  orderId: string;
  buyerId: string;
  sellerId: string;
  storeId?: string;
  productId: string;
  title: string;
  imageUrl?: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  currency: 'BDT' | 'USD' | 'EUR' | 'GBP';
  createdAt?: any;
}

export interface MarketplaceOrder {
  id: string;
  checkoutGroupId?: string;
  idempotencyKey: string;
  buyerId: string;
  buyerName: string;
  buyerUsername: string;
  sellerId: string;
  sellerName: string;
  sellerUsername: string;
  storeId?: string;
  storeName?: string;
  itemsSnapshot: Array<{
    productId: string;
    title: string;
    imageUrl?: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  itemProductIds: string[];
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  currency: 'BDT' | 'USD' | 'EUR' | 'GBP';
  deliveryOption: string;
  shippingAddress: OrderShippingAddress;
  paymentMethod: OrderPaymentMethod;
  paymentStatus: OrderPaymentStatus;
  paymentRef?: string;
  status: OrderStatus;
  sellerNote?: string;
  cancelReason?: string;
  trackingCode?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface MarketplacePayment {
  id: string;
  orderId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  currency: string;
  method: OrderPaymentMethod;
  transactionRef: string;
  senderAccount?: string;
  providerVerified: boolean;
  status: OrderPaymentStatus;
  refundReason?: string;
  reviewedBy?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface ProductReview {
  id: string;
  productId: string;
  sellerId: string;
  storeId?: string;
  orderId: string;
  reviewerId: string;
  reviewerName: string;
  reviewerUsername: string;
  reviewerAvatar?: string;
  rating: number;
  comment: string;
  imageUrls?: string[];
  isVerifiedPurchase: boolean;
  helpfulUserIds: string[];
  helpfulCount: number;
  status: 'active' | 'hidden';
  createdAt?: any;
  updatedAt?: any;
}

export interface MarketplaceReport {
  id: string;
  reporterId: string;
  targetType: 'product' | 'store' | 'review' | 'community' | 'event' | 'community_member' | 'community_post';
  targetId: string;
  communityId?: string;
  reason: string;
  details: string;
  status: 'pending' | 'resolved' | 'dismissed';
  resolutionNote?: string;
  createdAt?: any;
  updatedAt?: any;
}

export interface CommunityMemberRecord {
  id: string;
  communityId: string;
  userId: string;
  userName?: string;
  userUsername?: string;
  userAvatar?: string;
  role: CommunityRole;
  status: 'active' | 'pending' | 'restricted';
  createdAt?: any;
  updatedAt?: any;
}

export interface CommunityRequest {
  id: string;
  communityId: string;
  communityName?: string;
  requestType: 'join_request' | 'invite';
  fromUid: string;
  fromName?: string;
  targetUid: string;
  targetName?: string;
  targetUsername?: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt?: any;
  updatedAt?: any;
}

export interface CommunityPostItem {
  id: string;
  communityId: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorAvatar?: string;
  authorVerified?: boolean;
  authorRole?: CommunityRole;
  kind: 'post' | 'announcement' | 'poll';
  content: string;
  mediaUrls?: string[];
  mediaType?: 'image' | 'video' | 'none';
  pollQuestion?: string;
  pollOptions?: PollOption[];
  pollVoters?: Record<string, string>;
  isPinned?: boolean;
  likesUserIds?: string[];
  likesCount: number;
  commentsCount: number;
  status: 'active' | 'removed';
  createdAt?: any;
  updatedAt?: any;
}

export interface CommunityPostComment {
  id: string;
  communityId: string;
  postId: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  authorAvatar?: string;
  content: string;
  parentCommentId?: string;
  replyToUsername?: string;
  createdAt?: any;
}

export interface PaymentGatewayStatus {
  codEnabled: boolean;
  manualMobileBankingEnabled: boolean;
  sslcommerzConfigured: boolean;
  bkashGatewayConfigured: boolean;
  nagadGatewayConfigured: boolean;
  stripeConfigured: boolean;
  requiredEnvKeys: string[];
}

export const BANGLADESH_DISTRICTS: string[] = [
  'All Districts',
  'Dhaka',
  'Chattogram',
  'Sylhet',
  'Rajshahi',
  'Khulna',
  'Barishal',
  'Rangpur',
  'Mymensingh',
  'Cumilla',
  'Gazipur',
  'Narayanganj',
  'Cox’s Bazar',
  'Bogura',
  'Jessore',
];

export interface FriendRequestRecord {
  id: string;
  fromUid: string;
  toUid: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt?: any;
  updatedAt?: any;
}

export interface FriendshipRecord {
  id: string;
  participants: string[];
  createdAt?: any;
}

export interface FollowRequestRecord {
  id: string;
  fromUid: string;
  toUid: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt?: any;
  updatedAt?: any;
}

export interface UserRestrictionRecord {
  id: string;
  restrictorId: string;
  restrictedUid: string;
  createdAt?: any;
}

export interface VerificationHistoryEntry {
  status: 'pending' | 'approved' | 'rejected' | 'needs_info';
  note?: string;
  actorUid?: string;
  at: string;
}

export interface VerificationRequest {
  id: string;
  uid: string;
  username?: string;
  displayName?: string;
  type: 'identity' | 'organization';
  fullName: string;
  category: string;
  reason?: string;
  documentUrl?: string;
  documentName?: string;
  publicLinks: string[];
  status: 'pending' | 'approved' | 'rejected' | 'needs_info';
  adminNote?: string;
  userResponseNote?: string;
  reviewedBy?: string;
  history?: VerificationHistoryEntry[];
  createdAt?: any;
  updatedAt?: any;
}

export interface ProfileViewRecord {
  id: string;
  profileUid: string;
  viewerUid: string;
  dayKey: string;
  createdAt?: any;
}

