import {
  collection, doc, getDoc, getDocs, increment, limit, orderBy, query, serverTimestamp, setDoc, where,
} from 'firebase/firestore';
import { auth, db } from '@/src/firebase';
import type { BanaUser } from '@/src/types/bana';
import {
  cancelFriendRequest, getSocialRelationship, getUserFriendIds, sendFriendRequest,
  type FriendStatus, type SuggestedUserItem,
} from '@/src/lib/socialGraph';
import {
  dedupeByUid, exclusionReason, locationsMatch, normalizeSuggestionConfig, scoreCandidate,
  type CandidateSignals, type SuggestionConfig,
} from '@/src/lib/friendSuggestionsCore';

export * from '@/src/lib/friendSuggestionsCore';

/**
 * Friend Suggestions engine.
 *
 * Data used (all public or the viewer's own): friendships/friend requests (viewer's own), follows, community membership,
 * public profile interests/location. NEVER used: messages, private posts, uploaded contacts, anything not already readable.
 *
 * Scalability: no user-collection scan. Candidates come from small, bounded graph neighbourhoods
 * (friends-of-friends, community peers, followers, array-contains-any on interests, newest accounts) and are capped by
 * config.maxCandidates. Results are cached per user (sessionStorage) for config.cacheTtlMinutes.
 */

const CONFIG_TTL_MS = 5 * 60_000;
let configCache: { at: number; value: SuggestionConfig } | null = null;

export async function getSuggestionConfig(force = false): Promise<SuggestionConfig> {
  if (!force && configCache && Date.now() - configCache.at < CONFIG_TTL_MS) return configCache.value;
  let value: SuggestionConfig;
  try {
    const snap = await getDoc(doc(db, 'friendSuggestionConfig', 'settings'));
    value = normalizeSuggestionConfig(snap.exists() ? snap.data() : null);
  } catch {
    value = normalizeSuggestionConfig(null); // never block the feed because config could not be read
  }
  configCache = { at: Date.now(), value };
  return value;
}
export const resetSuggestionConfigCache = () => { configCache = null; };

/* ---------------- stats (aggregate counters only, no per-user data) ---------------- */

type StatKey = 'impressions' | 'requestsSent' | 'dismissals' | 'errors' | 'emptyResults' | 'runs' | 'cacheHits' | 'totalLatencyMs' | 'candidatesEvaluated';
const statBuf: Partial<Record<StatKey, number>> = {};
let lastErr = '';
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function recordSuggestionStat(key: StatKey, n = 1, error?: string) {
  statBuf[key] = (statBuf[key] || 0) + n;
  if (error) lastErr = error.slice(0, 200);
  if (!flushTimer) flushTimer = setTimeout(flushStats, 30_000);
}
async function flushStats() {
  flushTimer = null;
  const keys = Object.keys(statBuf) as StatKey[];
  if (keys.length === 0) return;
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const payload: Record<string, any> = { updatedAt: serverTimestamp() };
  for (const k of keys) payload[k] = increment(Math.min(statBuf[k] || 0, 5000));
  if (lastErr) payload.lastError = lastErr;
  keys.forEach((k) => delete statBuf[k]);
  lastErr = '';
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  // Per-user doc (id <day>_<uid>): rules only let a user write their own, capped counters. Client-reported => approximate.
  payload.uid = uid;
  payload.day = day;
  await setDoc(doc(db, 'friendSuggestionStats', `${day}_${uid}`), payload, { merge: true }).catch(() => {});
}

/* ---------------- cache ---------------- */

const cacheKey = (uid: string) => `bana_fs_v1_${uid}`;
function readCache(uid: string, ttlMin: number): SuggestedUserItem[] | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(uid));
    if (!raw) return null;
    const { at, items } = JSON.parse(raw);
    return Date.now() - at < ttlMin * 60_000 ? items : null;
  } catch { return null; }
}
function writeCache(uid: string, items: SuggestedUserItem[]) {
  try { sessionStorage.setItem(cacheKey(uid), JSON.stringify({ at: Date.now(), items })); } catch { /* quota / private mode */ }
}
export function invalidateSuggestionCache(uid: string) {
  try { sessionStorage.removeItem(cacheKey(uid)); } catch { /* ignore */ }
}
function dropFromCache(uid: string, targetUid: string) {
  const raw = (() => { try { return sessionStorage.getItem(cacheKey(uid)); } catch { return null; } })();
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    parsed.items = parsed.items.filter((i: SuggestedUserItem) => i.user.uid !== targetUid);
    sessionStorage.setItem(cacheKey(uid), JSON.stringify(parsed));
  } catch { /* ignore */ }
}

/* ---------------- generation ---------------- */

const bump = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) || 0) + 1);

export interface SuggestionResult { items: SuggestedUserItem[]; config: SuggestionConfig; fromCache: boolean }

export async function getFriendSuggestions(opts: {
  myProfile: BanaUser | null;
  blockedUids?: string[];
  dismissedUids?: string[];
  limitCount?: number;
  force?: boolean;
}): Promise<SuggestionResult> {
  const { myProfile, blockedUids = [], dismissedUids = [], limitCount = 8, force = false } = opts;
  const config = await getSuggestionConfig();
  const myUid = myProfile?.uid || '';
  if (!myUid || !config.enabled) return { items: [], config, fromCache: false };

  const dismissed = new Set(dismissedUids);
  const cached = force ? null : readCache(myUid, config.cacheTtlMinutes);
  if (cached) {
    recordSuggestionStat('cacheHits');
    return {
      items: cached.filter((i) => !dismissed.has(i.user.uid) && !blockedUids.includes(i.user.uid)).slice(0, limitCount),
      config,
      fromCache: true,
    };
  }

  const t0 = Date.now();
  try {
    const col = (n: string) => collection(db, n);
    const safe = <T>(p: Promise<T>) => p.catch(() => null as T | null);
    const myInterests = (myProfile?.interests || []).slice(0, 10);

    const [friendIds, outSnap, inSnap, followersSnap, myCommSnap, interestSnap, recentSnap] = await Promise.all([
      getUserFriendIds(myUid),
      safe(getDocs(query(col('friendRequests'), where('fromUid', '==', myUid), where('status', '==', 'pending'), limit(100)))),
      safe(getDocs(query(col('friendRequests'), where('toUid', '==', myUid), where('status', '==', 'pending'), limit(100)))),
      config.signals.followsYou ? safe(getDocs(query(col('userFollows'), where('followingId', '==', myUid), limit(40)))) : Promise.resolve(null),
      config.signals.sharedCommunities ? safe(getDocs(query(col('communityMembers'), where('userId', '==', myUid), limit(25)))) : Promise.resolve(null),
      config.signals.sharedInterests && myInterests.length
        ? safe(getDocs(query(col('users'), where('interests', 'array-contains-any', myInterests), limit(25))))
        : Promise.resolve(null),
      config.signals.recentlyJoined ? safe(getDocs(query(col('users'), orderBy('createdAt', 'desc'), limit(15)))) : Promise.resolve(null),
    ]);

    const friends = new Set(friendIds);
    const outgoing = new Set((outSnap?.docs || []).map((d) => d.data().toUid as string));
    const incoming = new Set((inSnap?.docs || []).map((d) => d.data().fromUid as string));
    const followers = new Set((followersSnap?.docs || []).map((d) => d.data().followerId as string));

    // friends-of-friends (bounded sample)
    const mutual = new Map<string, number>();
    if (config.signals.mutualFriends && friendIds.length) {
      // Random sample (not always the first N) so suggestions stay diverse; each read is bounded and permission-filtered by the
      // friend's own whoCanViewFriends setting (denied lists come back empty, so private lists never feed suggestions).
      const sampled = [...friendIds].sort(() => Math.random() - 0.5).slice(0, config.maxFriendsSampled);
      const lists = await Promise.all(sampled.map((f) => getUserFriendIds(f, 60)));
      lists.forEach((l) => l.forEach((u) => { if (u !== myUid && !friends.has(u)) bump(mutual, u); }));
    }
    // community peers (bounded: 3 communities x 15 members)
    const commPeers = new Map<string, number>();
    const myComms = Array.from(new Set((myCommSnap?.docs || []).map((d) => d.data().communityId as string))).slice(0, 3);
    if (myComms.length) {
      const snaps = await Promise.all(myComms.map((cid) => safe(getDocs(query(col('communityMembers'), where('communityId', '==', cid), limit(15))))));
      snaps.forEach((s) => s?.docs.forEach((d) => { const u = d.data().userId as string; if (u && u !== myUid) bump(commPeers, u); }));
    }

    // profiles we already have in hand
    const profiles = new Map<string, BanaUser>();
    interestSnap?.docs.forEach((d) => profiles.set(d.id, d.data() as BanaUser));
    const recentIds = new Set<string>();
    recentSnap?.docs.forEach((d) => { profiles.set(d.id, d.data() as BanaUser); recentIds.add(d.id); });

    // remaining ids, strongest graph signals first, capped
    const need = new Map<string, number>();
    const prior = (u: string, w: number) => need.set(u, (need.get(u) || 0) + w);
    mutual.forEach((c, u) => prior(u, c * 3));
    commPeers.forEach((c, u) => prior(u, c * 2));
    followers.forEach((u) => prior(u, 2));
    const ids = Array.from(need.entries()).sort((a, b) => b[1] - a[1]).map(([u]) => u).filter((u) => !profiles.has(u));
    const budget = Math.max(0, config.maxCandidates - profiles.size);
    const fetched = await Promise.all(ids.slice(0, budget).map((u) => safe(getDoc(doc(db, 'users', u)))));
    fetched.forEach((s) => { if (s?.exists()) profiles.set(s.id, s.data() as BanaUser); });

    const ctx = {
      myUid, friends, outgoingPending: outgoing, incomingPending: incoming,
      blockedByMe: new Set(blockedUids), dismissed,
    };
    const ranked: SuggestedUserItem[] = [];
    profiles.forEach((u, uid) => {
      const sharedInterests = (u.interests || []).filter((i) => (myProfile?.interests || []).includes(i));
      const signals: CandidateSignals = {
        mutualCount: mutual.get(uid) || 0,
        sharedCommunities: commPeers.get(uid) || 0,
        sharedInterests,
        sameLocation: locationsMatch(myProfile as any, u),
        followsYou: followers.has(uid),
        recentlyJoined: recentIds.has(uid),
      };
      if (exclusionReason({ ...u, uid }, ctx, signals)) return;
      const s = scoreCandidate(u, signals, config);
      if (!s.qualifies) return;
      ranked.push({ user: { ...u, uid }, score: s.score, mutualFriendsCount: signals.mutualCount, sharedInterests, reason: s.reason });
    });
    ranked.sort((a, b) => b.score - a.score);

    // "Did this person block me?" — only checkable per pair (userBlocks list is owner-only), so verify just the finalists.
    const finalists = dedupeByUid(ranked, Math.max(limitCount * 2, 20));
    const blockChecks = await Promise.all(finalists.map((i) => safe(getDoc(doc(db, 'userBlocks', `${i.user.uid}_${myUid}`)))));
    const clean = finalists.filter((_, idx) => !blockChecks[idx]?.exists());
    const items = clean.slice(0, 20);

    writeCache(myUid, items);
    recordSuggestionStat('runs');
    recordSuggestionStat('candidatesEvaluated', profiles.size);
    recordSuggestionStat('totalLatencyMs', Date.now() - t0);
    if (items.length === 0) recordSuggestionStat('emptyResults');
    return { items: items.slice(0, limitCount), config, fromCache: false };
  } catch (e: any) {
    recordSuggestionStat('errors', 1, e?.code || e?.message || 'unknown');
    throw e;
  }
}

/* ---------------- actions (all go through the existing friend system) ---------------- */

/** Sends a REAL request via the existing backend, then re-reads the relationship so the UI reflects the truth
 *  (e.g. an incoming request is auto-accepted by sendFriendRequest → 'friends'). */
export async function addFriendFromSuggestion(me: BanaUser, target: BanaUser): Promise<FriendStatus> {
  await sendFriendRequest(me, target);
  const rel = await getSocialRelationship(me.uid, target.uid);
  recordSuggestionStat('requestsSent');
  if (rel.friendStatus !== 'sent_pending') dropFromCache(me.uid, target.uid);
  return rel.friendStatus;
}

export async function undoFriendRequestFromSuggestion(me: BanaUser, targetUid: string): Promise<FriendStatus> {
  await cancelFriendRequest(me.uid, targetUid);
  const rel = await getSocialRelationship(me.uid, targetUid);
  return rel.friendStatus;
}

export function removeSuggestionFromCache(myUid: string, targetUid: string) {
  dropFromCache(myUid, targetUid);
  recordSuggestionStat('dismissals');
}
