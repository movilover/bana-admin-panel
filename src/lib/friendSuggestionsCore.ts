// Pure, dependency-free core of the Friend Suggestions engine (no Firebase / React) so it can be unit-tested with plain Node.

export const SIGNAL_KEYS = [
  'mutualFriends',
  'sharedCommunities',
  'sharedInterests',
  'sameLocation',
  'followsYou',
  'recentlyJoined',
  'verified',
  'popularity',
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

/** Signals that, on their own, can qualify someone as a suggestion. verified/popularity only boost. */
const QUALIFYING: SignalKey[] = ['mutualFriends', 'sharedCommunities', 'sharedInterests', 'sameLocation', 'followsYou', 'recentlyJoined'];

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  mutualFriends: 'Mutual friends',
  sharedCommunities: 'Shared communities',
  sharedInterests: 'Shared interests',
  sameLocation: 'Same location (only if both share it publicly)',
  followsYou: 'They follow you',
  recentlyJoined: 'Recently joined (fallback for new accounts)',
  verified: 'Verified profile (boost only)',
  popularity: 'Follower count (boost only)',
};

export interface SuggestionConfig {
  enabled: boolean;
  feedEnabled: boolean;
  feedFirstAfter: number; // first slot goes after this many posts
  feedEveryN: number; // then one slot every N posts
  cardsPerSlot: number;
  maxSlots: number;
  cacheTtlMinutes: number;
  maxFriendsSampled: number; // friends whose friend-lists are read for friends-of-friends
  maxCandidates: number; // hard cap on candidate profiles read per refresh
  weights: Record<SignalKey, number>;
  signals: Record<SignalKey, boolean>;
  updatedAt?: any;
  updatedBy?: string;
}

/** Fallback used only when no config document exists yet; admins override everything in the panel. */
export const DEFAULT_SUGGESTION_CONFIG: SuggestionConfig = {
  enabled: true,
  feedEnabled: true,
  feedFirstAfter: 4,
  feedEveryN: 10,
  cardsPerSlot: 6,
  maxSlots: 3,
  cacheTtlMinutes: 15,
  maxFriendsSampled: 8,
  maxCandidates: 60,
  weights: {
    mutualFriends: 25,
    sharedCommunities: 15,
    sharedInterests: 12,
    sameLocation: 8,
    followsYou: 20,
    recentlyJoined: 2,
    verified: 4,
    popularity: 3,
  },
  signals: {
    mutualFriends: true,
    sharedCommunities: true,
    sharedInterests: true,
    sameLocation: true,
    followsYou: true,
    recentlyJoined: true,
    verified: true,
    popularity: true,
  },
};

const clampInt = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeSuggestionConfig(raw: any): SuggestionConfig {
  const d = DEFAULT_SUGGESTION_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...d, weights: { ...d.weights }, signals: { ...d.signals } };
  const weights = {} as Record<SignalKey, number>;
  const signals = {} as Record<SignalKey, boolean>;
  for (const k of SIGNAL_KEYS) {
    weights[k] = clampInt(raw.weights?.[k], 0, 100, d.weights[k]);
    signals[k] = typeof raw.signals?.[k] === 'boolean' ? raw.signals[k] : d.signals[k];
  }
  return {
    enabled: raw.enabled !== false,
    feedEnabled: raw.feedEnabled !== false,
    feedFirstAfter: clampInt(raw.feedFirstAfter, 1, 50, d.feedFirstAfter),
    feedEveryN: clampInt(raw.feedEveryN, 3, 100, d.feedEveryN),
    cardsPerSlot: clampInt(raw.cardsPerSlot, 2, 12, d.cardsPerSlot),
    maxSlots: clampInt(raw.maxSlots, 0, 10, d.maxSlots),
    cacheTtlMinutes: clampInt(raw.cacheTtlMinutes, 1, 240, d.cacheTtlMinutes),
    maxFriendsSampled: clampInt(raw.maxFriendsSampled, 1, 20, d.maxFriendsSampled),
    maxCandidates: clampInt(raw.maxCandidates, 10, 120, d.maxCandidates),
    weights,
    signals,
    updatedAt: raw.updatedAt,
    updatedBy: raw.updatedBy,
  };
}

/** Indexes of posts AFTER which a suggestion slot is rendered. Never after every post. */
export function pickFeedSlots(postCount: number, cfg: SuggestionConfig): number[] {
  if (!cfg.enabled || !cfg.feedEnabled || cfg.maxSlots <= 0) return [];
  const slots: number[] = [];
  for (let i = cfg.feedFirstAfter - 1; i < postCount - 1 && slots.length < cfg.maxSlots; i += cfg.feedEveryN) slots.push(i);
  return slots;
}

/* ---------------- eligibility ---------------- */

export interface CandidateProfile {
  uid: string;
  accountStatus?: string;
  suggestionsOptOut?: boolean;
  whoCanFriendRequest?: 'everyone' | 'followers' | 'friends_of_friends' | 'nobody' | string;
  isPrivateAccount?: boolean;
  isVerified?: boolean;
  followersCount?: number;
  interests?: string[];
  location?: string;
  showLocation?: boolean;
  createdAt?: any;
}

export interface ExclusionContext {
  myUid: string;
  friends: Set<string>;
  outgoingPending: Set<string>;
  incomingPending: Set<string>;
  blockedByMe: Set<string>;
  dismissed: Set<string>;
}

export interface CandidateSignals {
  mutualCount: number;
  sharedCommunities: number;
  sharedInterests: string[];
  sameLocation: boolean;
  followsYou: boolean;
  recentlyJoined: boolean;
}

/** Returns null if the person may be suggested, otherwise the reason (useful for tests / debugging). */
export function exclusionReason(u: CandidateProfile, ctx: ExclusionContext, s: CandidateSignals): string | null {
  if (!u.uid || u.uid === ctx.myUid) return 'self';
  if (ctx.friends.has(u.uid)) return 'friend';
  if (ctx.outgoingPending.has(u.uid)) return 'outgoing_pending';
  if (ctx.incomingPending.has(u.uid)) return 'incoming_pending';
  if (ctx.blockedByMe.has(u.uid)) return 'blocked';
  if (ctx.dismissed.has(u.uid)) return 'dismissed';
  if (u.accountStatus !== 'active') return 'inactive';
  if (u.suggestionsOptOut === true) return 'opted_out';
  // Private accounts are never surfaced to strangers: they need a real connection signal (mutual friend or they follow the viewer).
  if (u.isPrivateAccount === true && s.mutualCount === 0 && !s.followsYou) return 'private_account';
  const policy = u.whoCanFriendRequest || 'everyone';
  if (policy === 'nobody') return 'not_accepting_requests';
  // A request that firestore.rules / sendFriendRequest would refuse must never be offered.
  if (policy === 'followers' && !s.followsYou) return 'requires_follower';
  if (policy === 'friends_of_friends' && s.mutualCount === 0) return 'requires_mutual';
  return null;
}

/* ---------------- scoring ---------------- */

export function scoreCandidate(
  u: CandidateProfile,
  s: CandidateSignals,
  cfg: SuggestionConfig
): { score: number; qualifies: boolean; reason: string } {
  const on = (k: SignalKey) => cfg.signals[k] && cfg.weights[k] > 0;
  let score = 0;
  const qualified = new Set<SignalKey>();
  const add = (k: SignalKey, amount: number) => {
    if (!on(k) || amount <= 0) return;
    score += amount * cfg.weights[k];
    if (QUALIFYING.includes(k)) qualified.add(k);
  };
  add('mutualFriends', Math.min(s.mutualCount, 10));
  add('sharedCommunities', Math.min(s.sharedCommunities, 3));
  add('sharedInterests', Math.min(s.sharedInterests.length, 5));
  add('sameLocation', s.sameLocation ? 1 : 0);
  add('followsYou', s.followsYou ? 1 : 0);
  add('recentlyJoined', s.recentlyJoined ? 1 : 0);
  if (qualified.size > 0) {
    if (on('verified') && u.isVerified) score += cfg.weights.verified;
    if (on('popularity')) score += Math.min(1, Math.log10(Math.max(1, u.followersCount || 1)) / 4) * cfg.weights.popularity;
  }

  // Reason shown to the user: strongest enabled qualifying signal by weighted contribution.
  let reason = '';
  if (qualified.has('mutualFriends')) reason = `${s.mutualCount} mutual friend${s.mutualCount > 1 ? 's' : ''}`;
  else if (qualified.has('followsYou')) reason = 'Follows you';
  else if (qualified.has('sharedCommunities')) reason = 'In your community';
  else if (qualified.has('sharedInterests')) reason = `Shares ${s.sharedInterests[0]}`;
  else if (qualified.has('sameLocation')) reason = `Near ${u.location}`;
  else if (qualified.has('recentlyJoined')) reason = 'New on BANA';
  return { score, qualifies: qualified.size > 0, reason };
}

/** Same-location only counts when BOTH sides expose their location publicly. */
export function locationsMatch(me: CandidateProfile & { showLocation?: boolean }, u: CandidateProfile): boolean {
  if (!me.location || !u.location) return false;
  if (me.showLocation === false || u.showLocation === false) return false;
  return me.location.trim().toLowerCase() === u.location.trim().toLowerCase();
}

/** Remove duplicates (keeps first = highest ranked) and cap. */
export function dedupeByUid<T extends { user: { uid: string } }>(items: T[], max: number): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    if (seen.has(it.user.uid)) continue;
    seen.add(it.user.uid);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}
