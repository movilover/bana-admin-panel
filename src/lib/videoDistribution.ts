import {
  collection, doc, documentId, getDoc, getDocs, increment, limit, orderBy, query, serverTimestamp, where, writeBatch,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import type { BanaReel } from '@/src/types/bana';
import {
  BACKFILL_SAFE_REASONS, EMPTY_STATS, buildDistributionFeed, contentKeyFor, deriveViewEvent, durationMsFromSeconds, isPlausibleEvent, viewerLanguageFromBrowser,
  deriveStage, normalizeDistributionConfig, normalizeStats, relevanceScore, viewEventId, viewerEligibility,
  type ContentLite, type DistributionConfig, type StageResult, type VideoStats, type ViewerProfile,
} from '@/src/lib/videoDistributionCore';

export * from '@/src/lib/videoDistributionCore';

/* ---------------- config (cached) ---------------- */
let cfgCache: { at: number; value: DistributionConfig } | null = null;
export async function getDistributionConfig(force = false): Promise<DistributionConfig> {
  if (!force && cfgCache && Date.now() - cfgCache.at < 5 * 60_000) return cfgCache.value;
  let value: DistributionConfig;
  try {
    const s = await getDoc(doc(db, 'videoDistributionConfig', 'settings'));
    value = normalizeDistributionConfig(s.exists() ? s.data() : null);
  } catch {
    value = normalizeDistributionConfig(null);
  }
  cfgCache = { at: Date.now(), value };
  return value;
}
export const resetDistributionConfigCache = () => { cfgCache = null; };

/* ---------------- local safeguards (rules are the real enforcement) ---------------- */
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

/** Client-side rate limit: at most 90 view events per rolling hour per device. */
function rateLimited(): boolean {
  const now = Date.now();
  let arr: number[] = [];
  try { arr = JSON.parse(lsGet('bana_vv_rate') || '[]'); } catch { arr = []; }
  arr = arr.filter((t) => now - t < 3_600_000);
  if (arr.length >= 90) return true;
  arr.push(now);
  lsSet('bana_vv_rate', JSON.stringify(arr));
  return false;
}

export interface VideoRef {
  type: 'reel' | 'post';
  id: string;
  authorId: string;
  createdAt: any; // Firestore Timestamp of the content doc (rules compare it to the real one)
}

const statsMeta = (v: VideoRef) => ({
  ownerId: v.authorId, contentType: v.type, contentId: v.id, contentCreatedAt: v.createdAt,
});

/**
 * Records ONE view event per viewer per video per UTC day. Counters are moved in the same batch by exactly what the event
 * implies; firestore.rules re-derive valid/completed/skipped/rewatched and reject anything else. Failures are silent.
 */
export async function recordVideoView(viewerUid: string, v: VideoRef, watchMs: number, durationMs: number): Promise<void> {
  try {
    watchMs = Math.round(watchMs);
    durationMs = Math.round(durationMs);
    if (!viewerUid || !v.createdAt || watchMs <= 0 || !isPlausibleEvent({ watchMs, durationMs })) return;
    const now = Date.now();
    const key = contentKeyFor(v.type, v.id);
    const evId = viewEventId(key, viewerUid, now);
    if (lsGet(`bana_vv_${evId}`)) return; // already reported today on this device
    if (rateLimited()) return;
    lsSet(`bana_vv_${evId}`, '1');

    const cfg = await getDistributionConfig();
    const d = deriveViewEvent({ watchMs, durationMs, viewerId: viewerUid, authorId: v.authorId }, cfg);
    const markerRef = doc(db, 'videoViewers', `${key}_${viewerUid}`);
    const firstEver = !(await getDoc(markerRef).then((s) => s.exists()).catch(() => true));

    const batch = writeBatch(db);
    batch.set(doc(db, 'reelViews', evId), {
      reelId: key, contentType: v.type, contentId: v.id, viewerId: viewerUid, authorId: v.authorId,
      watchMs, durationMs, valid: d.valid, completed: d.completed, skipped: d.skipped, rewatched: d.rewatched,
      createdAt: serverTimestamp(),
    });
    if (firstEver) batch.set(markerRef, { reelId: key, viewerId: viewerUid, createdAt: serverTimestamp() });
    const counters = {
      plays: increment(1),
      validViews: increment(d.valid ? 1 : 0),
      watchTimeMs: increment(watchMs),
      completions: increment(d.completed ? 1 : 0),
      rewatches: increment(d.rewatched ? 1 : 0),
      skips: increment(d.skipped ? 1 : 0),
    };
    // PRIVATE creator analytics (owner/admin readable) — includes uniqueViewers.
    batch.set(
      doc(db, 'videoStats', key),
      { ...statsMeta(v), ...counters, ...(firstEver ? { uniqueViewers: increment(1) } : {}), updatedAt: serverTimestamp() },
      { merge: true }
    );
    // PUBLIC ranking aggregates (client-reported, approximate) — minimum fields only.
    batch.set(doc(db, 'videoStatsPublic', key), { ...statsMeta(v), ...counters, updatedAt: serverTimestamp() }, { merge: true });
    await batch.commit();
  } catch {
    /* analytics must never break playback */
  }
}

export type FeedbackKind = 'not_interested' | 'hide' | 'hide_creator' | 'report';
// hide_creator is a personal preference signal (logged, applied via the viewer's hidden-creators list); it has no aggregate counter.
const COUNTER: Partial<Record<FeedbackKind, string>> = { not_interested: 'notInterested', hide: 'hides', report: 'reports' };

/** Stage one feedback signal (deterministic id => a duplicate fails atomically) plus its counters into `batch`. */
export function stageVideoFeedback(batch: ReturnType<typeof writeBatch>, viewerUid: string, v: VideoRef, kind: FeedbackKind): void {
  const key = contentKeyFor(v.type, v.id);
  batch.set(doc(db, 'videoFeedback', `${key}_${viewerUid}_${kind}`), {
    reelId: key, viewerId: viewerUid, kind, createdAt: serverTimestamp(),
  });
  const counter = COUNTER[kind];
  if (!counter) return;
  batch.set(doc(db, 'videoStats', key), { ...statsMeta(v), [counter]: increment(1), updatedAt: serverTimestamp() }, { merge: true });
  // Reports stay private (a report count is a moderation signal, not a public ranking input).
  if (kind !== 'report') {
    batch.set(doc(db, 'videoStatsPublic', key), { ...statsMeta(v), [counter]: increment(1), updatedAt: serverTimestamp() }, { merge: true });
  }
}

/** One feedback signal per viewer per video per kind. Returns true when saved, false on duplicate/offline/denied. */
export async function recordVideoFeedback(viewerUid: string, v: VideoRef, kind: FeedbackKind): Promise<boolean> {
  try {
    if (!viewerUid || !v.createdAt) return false;
    const batch = writeBatch(db);
    stageVideoFeedback(batch, viewerUid, v, kind);
    await batch.commit();
    return true;
  } catch {
    return false; // duplicate feedback (already recorded), offline or denied: never blocks the UI
  }
}

/* ---------------- seen list (avoid repeats) ---------------- */
export function getSeenKeys(): Set<string> {
  try { return new Set(JSON.parse(lsGet('bana_vd_seen') || '[]')); } catch { return new Set(); }
}
export function markSeen(key: string) {
  const arr = Array.from(getSeenKeys());
  if (arr.includes(key)) return;
  arr.push(key);
  lsSet('bana_vd_seen', JSON.stringify(arr.slice(-150)));
}

/* ---------------- stats / author lookups (chunked, cached) ---------------- */
const statsCache = new Map<string, { at: number; v: VideoStats }>();
export async function fetchStatsMap(keys: string[]): Promise<Map<string, VideoStats>> {
  const out = new Map<string, VideoStats>();
  const need: string[] = [];
  for (const k of keys) {
    const c = statsCache.get(k);
    if (c && Date.now() - c.at < 5 * 60_000) out.set(k, c.v); else need.push(k);
  }
  for (let i = 0; i < need.length; i += 30) {
    const chunk = need.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, 'videoStatsPublic'), where(documentId(), 'in', chunk))).catch(() => null);
    snap?.docs.forEach((d) => { const v = normalizeStats(d.data()); statsCache.set(d.id, { at: Date.now(), v }); out.set(d.id, v); });
    chunk.forEach((k) => { if (!out.has(k)) { statsCache.set(k, { at: Date.now(), v: { ...EMPTY_STATS, distStatus: 'auto' } }); out.set(k, { ...EMPTY_STATS, distStatus: 'auto' }); } });
  }
  return out;
}

const followerCache = new Map<string, { at: number; n: number }>();
async function authorFollowers(uids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  await Promise.all(uids.map(async (u) => {
    const c = followerCache.get(u);
    if (c && Date.now() - c.at < 30 * 60_000) { out.set(u, c.n); return; }
    const s = await getDoc(doc(db, 'users', u)).catch(() => null);
    const n = s?.exists() ? Number(s.data()?.followersCount || 0) : 1e9; // unknown → treat as established (no special exploration)
    followerCache.set(u, { at: Date.now(), n });
    out.set(u, n);
  }));
  return out;
}

/* ---------------- Reels adapter ---------------- */
const READY = new Set(['ready', 'backup_pending', 'backup_complete']);
export function reelToContent(r: BanaReel): ContentLite {
  return {
    key: r.id, authorId: r.authorId,
    createdMs: r.createdAt?.toMillis ? r.createdAt.toMillis() : Date.now(),
    durationMs: durationMsFromSeconds(r.durationSeconds), // 0 = unknown (legacy); never assume a length
    category: r.category, language: (r as any).language || undefined, likes: r.likesCount || 0, comments: r.commentsCount || 0, shares: r.sharesCount || 0, saves: r.savesCount || 0,
    processingReady: r.processingStatus ? READY.has(r.processingStatus) : true,
  };
}

export interface ReelDistribution {
  order: string[]; // reel ids in feed order
  extra: BanaReel[]; // reels pulled from the top pool that were not in the loaded window
  info: Record<string, { stage: number; status: string; reason: string }>;
  config: DistributionConfig;
}

export async function rankReelsWithDistribution(opts: {
  reels: BanaReel[];
  viewer: ViewerProfile;
  pageSize?: number;
  minFeed?: number;
}): Promise<ReelDistribution | null> {
  // Optional language signal: browser UI language, read locally only (never stored). Absent => no language effect.
  opts = { ...opts, viewer: { ...opts.viewer, language: opts.viewer.language ?? viewerLanguageFromBrowser() } };
  const config = await getDistributionConfig();
  if (!config.enabled) return null; // master switch off → caller keeps the legacy ranking
  const pageSize = opts.pageSize ?? 30;
  const pool = new Map(opts.reels.map((r) => [r.id, r]));

  // Optional top pool (best validated performers outside the recent window) — one bounded query, never a scan.
  const extra: BanaReel[] = [];
  if (config.topPoolSize > 0) {
    const top = await getDocs(query(collection(db, 'videoStatsPublic'), orderBy('validViews', 'desc'), limit(config.topPoolSize))).catch(() => null);
    const ids = (top?.docs || []).filter((d) => d.data().contentType === 'reel' && !pool.has(d.id)).map((d) => d.id).slice(0, 15);
    const docs = await Promise.all(ids.map((id) => getDoc(doc(db, 'reels', id)).catch(() => null)));
    docs.forEach((s) => {
      if (s?.exists() && s.data().status === 'active' && s.data().visibility === 'public') {
        const r = { id: s.id, ...(s.data() as Omit<BanaReel, 'id'>) } as BanaReel;
        pool.set(r.id, r); extra.push(r);
      }
    });
  }

  const reels = Array.from(pool.values());
  const statsMap = await fetchStatsMap(reels.map((r) => r.id));
  const contents = new Map(reels.map((r) => [r.id, reelToContent(r)]));
  const candidates = reels.map((r) => ({ content: contents.get(r.id)!, stats: statsMap.get(r.id) || { ...EMPTY_STATS } }));

  // New-creator detection only for videos still in the test stages (keeps reads small).
  let newCreatorIds = new Set<string>();
  if (config.newCreatorEnabled) {
    const testing = Array.from(new Set(candidates.filter((c) => c.stats.uniqueViewers < config.stage3Audience).map((c) => c.content.authorId))).slice(0, 25);
    const f = await authorFollowers(testing);
    newCreatorIds = new Set(testing.filter((u) => (f.get(u) ?? 1e9) <= config.newCreatorMaxFollowers));
  }

  const nowMs = Date.now();
  let res = buildDistributionFeed({ candidates, viewer: opts.viewer, config, nowMs, pageSize, newCreatorIds });
  const info: ReelDistribution['info'] = {};
  const record = (c: { content: ContentLite; stage: StageResult }) => { info[c.content.key] = { stage: c.stage.stage, status: c.stage.status, reason: c.stage.reason }; };
  res.items.forEach(record);
  let order = res.items.map((i) => i.content.key);

  // Graceful degradation: a small platform may have too few relevant, unseen videos. Backfill ONLY with videos that were
  // skipped for ordinary audience gating (never safety, blocks, hidden creators or "not interested").
  const minFeed = opts.minFeed ?? 6;
  if (order.length < minFeed) {
    const soft = res.excludedItems.filter((e) => BACKFILL_SAFE_REASONS.has(e.reason)).map((e) => e.key).filter((k) => !order.includes(k));
    const byFresh = soft.sort((a, b) => (contents.get(b)?.createdMs || 0) - (contents.get(a)?.createdMs || 0));
    order = [...order, ...byFresh].slice(0, Math.max(minFeed, order.length));
  }
  return { order, extra, info, config };
}

/* ---------------- Video posts adapter (news feed) ---------------- */

/** Returns ids of video posts that must NOT be recommended to this viewer right now (stage gating / safety). Followers are never gated. */
export async function hiddenVideoPostIds(
  posts: Array<{ id: string; type?: string; authorId: string; createdAt?: any; category?: string; language?: string; videoDurationSeconds?: number; likesCount?: number; commentsCount?: number; sharesCount?: number; savesCount?: number }>,
  viewerIn: ViewerProfile
): Promise<Set<string>> {
  const viewer: ViewerProfile = { ...viewerIn, language: viewerIn.language ?? viewerLanguageFromBrowser() };
  const config = await getDistributionConfig();
  const hidden = new Set<string>();
  if (!config.enabled) return hidden;
  const vids = posts.filter((p) => p.type === 'video');
  if (vids.length === 0) return hidden;
  const statsMap = await fetchStatsMap(vids.map((p) => contentKeyFor('post', p.id)));
  const nowMs = Date.now();
  const testing = Array.from(new Set(vids.map((p) => p.authorId))).slice(0, 25);
  const f = config.newCreatorEnabled ? await authorFollowers(testing) : new Map<string, number>();
  for (const p of vids) {
    const key = contentKeyFor('post', p.id);
    const content: ContentLite = {
      key, authorId: p.authorId, createdMs: p.createdAt?.toMillis ? p.createdAt.toMillis() : nowMs, durationMs: durationMsFromSeconds(p.videoDurationSeconds),
      category: p.category, language: (p as any).language || undefined, likes: p.likesCount || 0, comments: p.commentsCount || 0, shares: p.sharesCount || 0, saves: p.savesCount || 0,
      processingReady: true,
    };
    const stats = statsMap.get(key) || { ...EMPTY_STATS };
    const stage = deriveStage(stats, content, config, nowMs);
    const isNew = (f.get(p.authorId) ?? 1e9) <= config.newCreatorMaxFollowers;
    const el = viewerEligibility(viewer, content, stage, config, relevanceScore(viewer, content), isNew);
    // Only hide for stage gating & safety; blocks / hidden creators / dismissals are already handled by the feed itself.
    if (!el.ok && !['own_video', 'blocked', 'hidden_creator', 'not_interested'].includes(el.reason)) hidden.add(p.id);
  }
  return hidden;
}
