// Smart Video Distribution — pure core (no Firebase / React). Unit-tested with plain Node.
// Everything here is deterministic so every client derives the same stage/eligibility from the same
// rule-validated aggregate counters (Spark plan: there is no server process to compute it centrally).

export interface DistributionConfig {
  enabled: boolean; // master switch: off → legacy ranking, no gating
  progressiveEnabled: boolean; // off → no staged gating, ranking only
  // ---- view definitions (re-verified by firestore.rules) ----
  validMinWatchMs: number;
  validMinPercent: number; // OR: watched this % of the video
  completionPercent: number;
  skipMs: number;
  // ---- stages ----
  stage1Audience: number; // max unique viewers at stage 1
  stage2Audience: number;
  stage3Audience: number;
  audienceSampleRate: number; // % of eligible viewers sampled while a video is in stages 1-3
  stageMinRelevance: number; // 0-100: min relevance score for non-followers during stages 1-3
  evalMinValidViews: number;
  evalWindowHours: number;
  // ---- evaluation thresholds ----
  minAvgWatchPercent: number;
  minCompletionPercent: number;
  minEngagementPercent: number; // (likes+2*comments+3*shares+3*saves) per valid view, %
  maxSkipPercent: number;
  maxNegativePercent: number; // (not interested + hide) per play, %
  reportsToRestrict: number;
  // ---- quality / safety minimums ----
  minDurationSec: number;
  requireProcessingReady: boolean;
  // ---- exploration / diversity ----
  newCreatorEnabled: boolean;
  newCreatorMaxFollowers: number;
  newCreatorSlotPercent: number; // % of each page reserved for new-creator videos
  maxPerCreatorPerPage: number;
  freshnessHalfLifeHours: number;
  priorStrength: number; // smoothing: how many "virtual" views the neutral prior is worth
  // ---- candidate selection / cost ----
  recentPoolSize: number;
  topPoolSize: number;
  feedCacheMinutes: number;
  weights: RankingWeights;
}

export interface RankingWeights {
  relevance: number;
  watchTime: number;
  completion: number;
  rewatch: number;
  engagement: number;
  freshness: number;
  following: number;
  skipPenalty: number;
  negativePenalty: number;
  reportPenalty: number;
}
export const WEIGHT_KEYS: (keyof RankingWeights)[] = [
  'relevance', 'watchTime', 'completion', 'rewatch', 'engagement', 'freshness', 'following', 'skipPenalty', 'negativePenalty', 'reportPenalty',
];

/** Fallback when no config doc exists; administrators override all of it in the panel. */
export const DEFAULT_DISTRIBUTION_CONFIG: DistributionConfig = {
  enabled: true,
  progressiveEnabled: true,
  validMinWatchMs: 3000,
  validMinPercent: 50,
  completionPercent: 90,
  skipMs: 2000,
  stage1Audience: 50,
  stage2Audience: 300,
  stage3Audience: 2000,
  audienceSampleRate: 25,
  stageMinRelevance: 25,
  evalMinValidViews: 20,
  evalWindowHours: 48,
  minAvgWatchPercent: 35,
  minCompletionPercent: 15,
  minEngagementPercent: 3,
  maxSkipPercent: 60,
  maxNegativePercent: 8,
  reportsToRestrict: 3,
  minDurationSec: 1,
  requireProcessingReady: true,
  newCreatorEnabled: true,
  newCreatorMaxFollowers: 100,
  newCreatorSlotPercent: 15,
  maxPerCreatorPerPage: 2,
  freshnessHalfLifeHours: 36,
  priorStrength: 10,
  recentPoolSize: 40,
  topPoolSize: 20,
  feedCacheMinutes: 5,
  weights: {
    relevance: 30, watchTime: 25, completion: 15, rewatch: 5, engagement: 15, freshness: 10, following: 15,
    skipPenalty: 20, negativePenalty: 40, reportPenalty: 30,
  },
};

const INT_BOUNDS: Record<string, [number, number]> = {
  validMinWatchMs: [500, 30000], validMinPercent: [10, 100], completionPercent: [50, 100], skipMs: [200, 10000],
  stage1Audience: [5, 10000], stage2Audience: [10, 100000], stage3Audience: [50, 1000000],
  audienceSampleRate: [1, 100], stageMinRelevance: [0, 100], evalMinValidViews: [3, 5000], evalWindowHours: [1, 720],
  minAvgWatchPercent: [0, 100], minCompletionPercent: [0, 100], minEngagementPercent: [0, 100],
  maxSkipPercent: [0, 100], maxNegativePercent: [0, 100], reportsToRestrict: [1, 50], minDurationSec: [0, 600],
  newCreatorMaxFollowers: [0, 1000000], newCreatorSlotPercent: [0, 50], maxPerCreatorPerPage: [1, 10],
  freshnessHalfLifeHours: [1, 720], priorStrength: [1, 200], recentPoolSize: [10, 100], topPoolSize: [0, 60], feedCacheMinutes: [1, 60],
};
export const CONFIG_INT_BOUNDS = INT_BOUNDS;

const clampInt = (v: unknown, [min, max]: [number, number], fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export function normalizeDistributionConfig(raw: any): DistributionConfig {
  const d = DEFAULT_DISTRIBUTION_CONFIG;
  const out: any = { ...d, weights: { ...d.weights } };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(INT_BOUNDS)) out[k] = clampInt(raw[k], INT_BOUNDS[k], (d as any)[k]);
  for (const k of ['enabled', 'progressiveEnabled', 'requireProcessingReady', 'newCreatorEnabled'] as const) {
    out[k] = typeof raw[k] === 'boolean' ? raw[k] : d[k];
  }
  for (const k of WEIGHT_KEYS) out.weights[k] = clampInt(raw.weights?.[k], [0, 100], d.weights[k]);
  // stage audiences must be strictly increasing so "expansion" always means a bigger audience
  out.stage2Audience = Math.max(out.stage2Audience, out.stage1Audience + 1);
  out.stage3Audience = Math.max(out.stage3Audience, out.stage2Audience + 1);
  out.updatedAt = raw.updatedAt;
  out.updatedBy = raw.updatedBy;
  return out as DistributionConfig;
}

/* ------------------------------------------------------------------ */
/* Event rules (the SAME formulas are enforced in firestore.rules)      */
/* ------------------------------------------------------------------ */

export interface ViewEventInput { watchMs: number; durationMs: number; viewerId: string; authorId: string }
export interface ViewEventDerived { valid: boolean; completed: boolean; skipped: boolean; rewatched: boolean }

export function deriveViewEvent(e: ViewEventInput, c: DistributionConfig): ViewEventDerived {
  const completed = e.watchMs * 100 >= e.durationMs * c.completionPercent;
  const valid =
    e.viewerId !== e.authorId && (e.watchMs >= c.validMinWatchMs || e.watchMs * 100 >= e.durationMs * c.validMinPercent);
  return {
    valid,
    completed,
    skipped: e.watchMs < c.skipMs && !completed,
    rewatched: e.watchMs * 2 >= e.durationMs * 3,
  };
}

/** Accepted range for a client-reported event. watchMs can exceed duration only for loops (max 4x). */
export function isPlausibleEvent(e: { watchMs: number; durationMs: number }): boolean {
  return Number.isInteger(e.watchMs) && Number.isInteger(e.durationMs) && e.durationMs >= 500 && e.durationMs <= 3_600_000 &&
    e.watchMs >= 0 && e.watchMs <= e.durationMs * 4;
}

/** Stable UTC day key — identical to the one firestore.rules derives from request.time. */
export function utcDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
}
export const viewEventId = (contentKey: string, viewerId: string, ms: number) => `${contentKey}_${viewerId}_${utcDayKey(ms)}`;
export const contentKeyFor = (type: 'reel' | 'post', id: string) => (type === 'reel' ? id : `post_${id}`);

/* ------------------------------------------------------------------ */
/* Metrics                                                              */
/* ------------------------------------------------------------------ */

export interface VideoStats {
  plays: number; validViews: number; uniqueViewers: number; watchTimeMs: number;
  completions: number; rewatches: number; skips: number; notInterested: number; hides: number; reports: number;
  distStatus?: 'auto' | 'paused' | 'stopped' | 'under_review' | 'restricted';
}
export const EMPTY_STATS: VideoStats = {
  plays: 0, validViews: 0, uniqueViewers: 0, watchTimeMs: 0, completions: 0, rewatches: 0, skips: 0, notInterested: 0, hides: 0, reports: 0,
};
export const normalizeStats = (raw: any): VideoStats => {
  const n = (v: any) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  return {
    plays: n(raw?.plays), validViews: n(raw?.validViews), uniqueViewers: n(raw?.uniqueViewers), watchTimeMs: n(raw?.watchTimeMs),
    completions: n(raw?.completions), rewatches: n(raw?.rewatches), skips: n(raw?.skips), notInterested: n(raw?.notInterested),
    hides: n(raw?.hides), reports: n(raw?.reports),
    distStatus: ['paused', 'stopped', 'under_review', 'restricted'].includes(raw?.distStatus) ? raw.distStatus : 'auto',
  };
};

export interface ContentLite {
  key: string; authorId: string; createdMs: number;
  /** Real duration in ms. 0 = unknown (legacy content) — never substituted with an assumed length. */
  durationMs: number;
  category?: string; language?: string;
  likes: number; comments: number; shares: number; saves: number;
  processingReady?: boolean; authorFollowers?: number;
}

export interface VideoMetrics {
  avgWatchMs: number; avgWatchRatio: number; completionRate: number; rewatchRate: number; skipRate: number;
  negativeRate: number; engagementRate: number; validRate: number;
}
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function computeMetrics(s: VideoStats, c: Pick<ContentLite, 'durationMs' | 'likes' | 'comments' | 'shares' | 'saves'>): VideoMetrics {
  const avgWatchMs = div(s.watchTimeMs, s.plays);
  return {
    avgWatchMs,
    avgWatchRatio: Math.min(1, div(avgWatchMs, c.durationMs)),
    completionRate: div(s.completions, s.plays),
    rewatchRate: div(s.rewatches, s.plays),
    skipRate: div(s.skips, s.plays),
    negativeRate: div(s.notInterested + s.hides, s.plays),
    engagementRate: Math.min(1, div(c.likes + 2 * c.comments + 3 * c.shares + 3 * c.saves, s.validViews)),
    validRate: div(s.validViews, s.plays),
  };
}

/** Suspicious-activity heuristics. A flagged video is dampened in ranking and cannot expand further. */
export function suspicionFlags(s: VideoStats, c: Pick<ContentLite, 'durationMs' | 'likes' | 'comments'>): string[] {
  const flags: string[] = [];
  if (s.validViews >= 20 && s.uniqueViewers < 3) flags.push('few_distinct_viewers');
  if (c.durationMs > 0 && s.plays > 0 && s.watchTimeMs / s.plays > c.durationMs * 3.2) flags.push('implausible_watch_time');
  if (s.validViews >= 10 && c.likes > s.uniqueViewers * 1.5 + 5) flags.push('likes_exceed_viewers');
  if (s.validViews >= 10 && c.comments > s.uniqueViewers * 1.5 + 5) flags.push('comments_exceed_viewers');
  if (s.uniqueViewers > s.plays && s.plays > 0) flags.push('inconsistent_counters');
  return flags;
}

/* ------------------------------------------------------------------ */
/* Stage derivation                                                     */
/* ------------------------------------------------------------------ */

export type StageStatus = 'testing' | 'expanding' | 'continued' | 'limited' | 'under_review' | 'paused' | 'stopped' | 'ineligible';
export interface StageResult {
  stage: 0 | 1 | 2 | 3 | 4; // 0 = not recommended
  status: StageStatus;
  audienceCap: number; // max unique viewers outside followers; Infinity at stage 4
  recommendable: boolean;
  followersOnly: boolean;
  reason: string;
}

export function passesQuality(m: VideoMetrics, s: VideoStats, c: DistributionConfig): { pass: boolean; failed: string[] } {
  const failed: string[] = [];
  if (m.avgWatchRatio * 100 < c.minAvgWatchPercent) failed.push('avg_watch');
  if (m.completionRate * 100 < c.minCompletionPercent) failed.push('completion');
  if (m.engagementRate * 100 < c.minEngagementPercent) failed.push('engagement');
  if (m.skipRate * 100 > c.maxSkipPercent) failed.push('skip_rate');
  if (m.negativeRate * 100 > c.maxNegativePercent) failed.push('negative_feedback');
  // REMEDIATION: report counts never gate distribution automatically (reports are review signals, not proof; they can be brigaded).
  return { pass: failed.length === 0, failed };
}

export function isEligibleContent(ct: ContentLite, c: DistributionConfig): string | null {
  if (ct.durationMs > 0 && ct.durationMs < c.minDurationSec * 1000) return 'too_short';
  if (c.requireProcessingReady && ct.processingReady === false) return 'not_processed';
  return null;
}

/**
 * Effective stage = f(counters, config, age, admin status). Safety always wins over performance.
 *   stage 1  initial audience test (cap stage1Audience)
 *   stage 2  expanded after passing evaluation #1 (cap stage2Audience)
 *   stage 3  expanded after passing evaluation #2 (cap stage3Audience)
 *   stage 4  open, ranking-driven continued recommendation
 * A failed evaluation never expands: the video is 'limited' to its current audience cap.
 */
export function deriveStage(stats: VideoStats, content: ContentLite, c: DistributionConfig, nowMs: number): StageResult {
  const none = (status: StageStatus, reason: string, followersOnly = false): StageResult =>
    ({ stage: 0, status, audienceCap: 0, recommendable: false, followersOnly, reason });

  if (stats.distStatus === 'stopped') return none('stopped', 'Stopped by an administrator');
  if (stats.distStatus === 'paused') return none('paused', 'Paused by an administrator');
  if (stats.distStatus === 'restricted') return none('limited', 'Restricted: followers only', true);
  const ineligible = isEligibleContent(content, c);
  if (ineligible) return none('ineligible', ineligible);

  const underReview = stats.distStatus === 'under_review'; // only an authorised moderation decision, never a report count
  if (!c.enabled) return { stage: 4, status: 'continued', audienceCap: Infinity, recommendable: true, followersOnly: false, reason: 'Distribution system disabled' };

  const m = computeMetrics(stats, content);
  const caps = [c.stage1Audience, c.stage2Audience, c.stage3Audience];
  const ageH = (nowMs - content.createdMs) / 3_600_000;
  const suspicious = suspicionFlags(stats, content).length > 0;

  if (underReview) {
    // Under review never expands beyond the initial test, whatever the engagement says.
    return { stage: 1, status: 'under_review', audienceCap: caps[0], recommendable: stats.uniqueViewers < caps[0], followersOnly: false, reason: 'Under review: expansion blocked' };
  }
  if (!c.progressiveEnabled) {
    return { stage: 4, status: 'continued', audienceCap: Infinity, recommendable: true, followersOnly: false, reason: 'Progressive distribution disabled' };
  }

  // Walk the stages: advance only when the previous cap was reached AND the evaluation passed.
  let stage: 1 | 2 | 3 | 4 = 1;
  for (let i = 0; i < 3; i++) {
    const cap = caps[i];
    const reached = stats.uniqueViewers >= cap;
    const windowOver = ageH >= c.evalWindowHours;
    const enoughData = stats.validViews >= c.evalMinValidViews;
    if (!reached && !(windowOver && enoughData)) break; // still collecting data at this stage
    if (!enoughData) break; // not enough evidence → no expansion
    const q = passesQuality(m, stats, c);
    if (!q.pass || suspicious) {
      return { stage: (i + 1) as 1 | 2 | 3, status: 'limited', audienceCap: cap, recommendable: stats.uniqueViewers < cap,
        followersOnly: false, reason: suspicious ? 'Limited: suspicious activity' : `Limited: ${q.failed.join(', ')}` };
    }
    stage = (i + 2) as 2 | 3 | 4;
    if (!reached) break; // passed on the time window; expansion applies from the next stage's cap
  }

  if (stage === 4) {
    const bad = m.skipRate * 100 > c.maxSkipPercent || m.negativeRate * 100 > c.maxNegativePercent;
    return { stage: 4, status: bad ? 'limited' : 'continued', audienceCap: Infinity, recommendable: !bad || stats.validViews < c.evalMinValidViews * 5,
      followersOnly: false, reason: bad ? 'Reduced: viewers skip or reject it' : 'Continued recommendation' };
  }
  const cap = caps[stage - 1];
  return { stage, status: stage === 1 ? 'testing' : 'expanding', audienceCap: cap, recommendable: stats.uniqueViewers < cap, followersOnly: false,
    reason: stage === 1 ? 'Initial audience test' : 'Expanded after a passing evaluation' };
}

/* ------------------------------------------------------------------ */
/* Viewer relevance + eligibility                                       */
/* ------------------------------------------------------------------ */

export interface ViewerProfile {
  uid: string;
  following: Set<string>;
  interests: string[];
  interestWeights: Record<string, number>;
  language?: string;
  blockedAuthors: Set<string>;
  hiddenAuthors: Set<string>;
  dismissed: Set<string>; // content keys / ids the viewer marked not interested
  seen: Set<string>; // recently shown (this device) → avoid repeats
}

/** 0-100. Uses only user-selected interests, follows, onsite interest weights and language. */
export function relevanceScore(v: ViewerProfile, ct: ContentLite): number {
  let s = 0;
  if (ct.category) {
    if (v.interests.includes(ct.category)) s += 45;
    const w = Number(v.interestWeights[ct.category] || 0);
    s += Math.min(25, Math.max(0, w) * 5);
  }
  if (v.following.has(ct.authorId)) s += 30;
  if (v.language && ct.language) s += v.language === ct.language ? 5 : -10;
  return Math.max(0, Math.min(100, s));
}

/** FNV-1a + murmur3 finalizer → [0,1). Stable per (content, viewer) so sampling needs no coordination between clients. */
export function hashFraction(contentKey: string, viewerId: string): number {
  let h = 0x811c9dc5;
  const str = `${contentKey}|${viewerId}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // murmur3 finalizer: FNV alone has weak high bits for similar/sequential ids, which would skew sampling rates.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function viewerEligibility(
  v: ViewerProfile, ct: ContentLite, st: StageResult, c: DistributionConfig, relevance: number, isNewCreator: boolean
): { ok: boolean; reason: string } {
  if (ct.authorId === v.uid) return { ok: false, reason: 'own_video' };
  if (v.blockedAuthors.has(ct.authorId)) return { ok: false, reason: 'blocked' };
  if (v.hiddenAuthors.has(ct.authorId)) return { ok: false, reason: 'hidden_creator' };
  if (v.dismissed.has(ct.key)) return { ok: false, reason: 'not_interested' };
  const follows = v.following.has(ct.authorId);
  if (st.followersOnly) return follows ? { ok: true, reason: 'follower' } : { ok: false, reason: 'followers_only' };
  if (!st.recommendable) return follows && st.stage > 0 ? { ok: true, reason: 'follower' } : { ok: false, reason: st.status };
  if (follows) return { ok: true, reason: 'follower' };
  if (st.stage === 4) return { ok: true, reason: 'open' };
  // stages 1-3: relevant AND sampled → "a small, relevant audience", never everyone
  const minRel = isNewCreator && c.newCreatorEnabled ? Math.floor(c.stageMinRelevance / 2) : c.stageMinRelevance;
  if (relevance < minRel) return { ok: false, reason: 'not_relevant' };
  if (hashFraction(ct.key, v.uid) * 100 >= c.audienceSampleRate) return { ok: false, reason: 'not_sampled' };
  return { ok: true, reason: 'sampled' };
}

/* ------------------------------------------------------------------ */
/* Ranking                                                              */
/* ------------------------------------------------------------------ */

const smooth = (observed: number, n: number, prior: number, k: number) => (observed * n + prior * k) / (n + k);

export function rankScore(
  s: VideoStats, ct: ContentLite, relevance: number, follows: boolean, c: DistributionConfig, nowMs: number
): { score: number; parts: Record<string, number> } {
  const m = computeMetrics(s, ct);
  const w = c.weights;
  const k = c.priorStrength;
  // Neutral priors: a brand-new video is neither rewarded nor punished for having no data (fair to new creators).
  const watch = smooth(m.avgWatchRatio, s.plays, 0.5, k);
  const completion = smooth(m.completionRate, s.plays, 0.3, k);
  const rewatch = smooth(m.rewatchRate, s.plays, 0.05, k);
  const engagement = smooth(m.engagementRate, s.validViews, 0.05, k);
  const skip = smooth(m.skipRate, s.plays, 0.3, k);
  const negative = smooth(m.negativeRate, s.plays, 0.02, k);
  const ageH = Math.max(0, (nowMs - ct.createdMs) / 3_600_000);
  const freshness = Math.pow(0.5, ageH / Math.max(1, c.freshnessHalfLifeHours));
  // Trust: a video whose numbers look artificial counts for much less. Uses unique viewers, not raw plays.
  const trust = suspicionFlags(s, ct).length ? 0.5 : 1;
  const reportPressure = Math.min(1, s.reports / Math.max(1, c.reportsToRestrict));

  const parts = {
    relevance: (relevance / 100) * w.relevance,
    watch: watch * w.watchTime * trust,
    completion: completion * w.completion * trust,
    rewatch: Math.min(1, rewatch * 4) * w.rewatch * trust,
    engagement: Math.min(1, engagement * 5) * w.engagement * trust,
    freshness: freshness * w.freshness,
    following: follows ? w.following : 0,
    skip: -skip * w.skipPenalty,
    negative: -Math.min(1, negative * 10) * w.negativePenalty,
    reports: -reportPressure * w.reportPenalty,
  };
  return { score: Object.values(parts).reduce((a, b) => a + b, 0), parts };
}

export interface Candidate {
  content: ContentLite;
  stats: VideoStats;
  stage: StageResult;
  relevance: number;
  score: number;
  isNewCreator: boolean;
  reason: string;
}

/** Greedy diversity re-rank: each extra video from the same creator is discounted, with a hard per-page cap. */
export function diversify(ranked: Candidate[], pageSize: number, maxPerCreator: number): Candidate[] {
  const picked: Candidate[] = [];
  const counts = new Map<string, number>();
  const pool = [...ranked];
  while (picked.length < pageSize && pool.length) {
    let bestIdx = -1;
    let best = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const n = counts.get(pool[i].content.authorId) || 0;
      if (n >= maxPerCreator) continue;
      const eff = pool[i].score * Math.pow(0.6, n) - n * 2;
      if (eff > best) { best = eff; bestIdx = i; }
    }
    if (bestIdx < 0) break;
    const [chosen] = pool.splice(bestIdx, 1);
    picked.push(chosen);
    counts.set(chosen.content.authorId, (counts.get(chosen.content.authorId) || 0) + 1);
  }
  return picked;
}

export interface BuildFeedInput {
  candidates: Array<{ content: ContentLite; stats: VideoStats }>;
  viewer: ViewerProfile;
  config: DistributionConfig;
  nowMs: number;
  pageSize: number;
  newCreatorIds?: Set<string>; // authors under newCreatorMaxFollowers
}

/** Full pipeline: stage → eligibility → score → exploration slots → diversity. Pure & deterministic. */
export function buildDistributionFeed(inp: BuildFeedInput): { items: Candidate[]; excluded: Record<string, number>; excludedItems: Array<{ key: string; reason: string }> } {
  const { viewer, config: c, nowMs } = inp;
  const excluded: Record<string, number> = {};
  const excludedItems: Array<{ key: string; reason: string }> = [];
  const bump = (r: string, key = '') => { excluded[r] = (excluded[r] || 0) + 1; if (key) excludedItems.push({ key, reason: r }); };
  const eligible: Candidate[] = [];
  for (const { content, stats } of inp.candidates) {
    if (viewer.seen.has(content.key) || viewer.seen.has(content.key.replace(/^post_/, ''))) { bump('recently_shown', content.key); continue; }
    const stage = deriveStage(stats, content, c, nowMs);
    const relevance = relevanceScore(viewer, content);
    const isNew = Boolean(inp.newCreatorIds?.has(content.authorId));
    const el = viewerEligibility(viewer, content, stage, c, relevance, isNew);
    if (!el.ok) { bump(el.reason, content.key); continue; }
    const { score } = rankScore(stats, content, relevance, viewer.following.has(content.authorId), c, nowMs);
    eligible.push({ content, stats, stage, relevance, score, isNewCreator: isNew, reason: el.reason });
  }
  eligible.sort((a, b) => b.score - a.score);

  // Exploration: reserve slots for new creators' videos still in the test stages, ranked by relevance + freshness (not by popularity).
  const slots = c.newCreatorEnabled ? Math.round((inp.pageSize * c.newCreatorSlotPercent) / 100) : 0;
  const explore = eligible
    .filter((x) => x.isNewCreator && x.stage.stage > 0 && x.stage.stage <= 3)
    .sort((a, b) => b.relevance + b.content.createdMs / 1e11 - (a.relevance + a.content.createdMs / 1e11))
    .slice(0, slots);
  const exploreKeys = new Set(explore.map((x) => x.content.key));
  const rest = diversify(eligible.filter((x) => !exploreKeys.has(x.content.key)), inp.pageSize - explore.length, c.maxPerCreatorPerPage);
  // interleave exploration picks evenly instead of stacking them at the top
  const items = [...rest];
  explore.forEach((x, i) => items.splice(Math.min(items.length, 2 + i * Math.max(2, Math.floor(inp.pageSize / (explore.length + 1)))), 0, x));
  // final guard: hard per-creator cap while preserving the interleaved order
  const counts = new Map<string, number>();
  const final: Candidate[] = [];
  for (const it of items) {
    const n = counts.get(it.content.authorId) || 0;
    if (n >= c.maxPerCreatorPerPage) continue;
    counts.set(it.content.authorId, n + 1);
    final.push(it);
  }
  return { items: final.slice(0, inp.pageSize), excluded, excludedItems };
}

/** Exclusion reasons that are ordinary audience gating. Safety, privacy and user choices are NEVER used for backfill. */
export const BACKFILL_SAFE_REASONS = new Set(['not_relevant', 'not_sampled', 'recently_shown']);

/** 'post_abc' → {type:'post', id:'abc'}; anything else is a reel id. */
export function toStatsKeyParts(key: string): { type: 'reel' | 'post'; id: string } {
  return key.startsWith('post_') ? { type: 'post', id: key.slice(5) } : { type: 'reel', id: key };
}

/** Duration helper: seconds (maybe undefined/legacy) -> ms, 0 when unknown. Never assumes a default length. */
export const durationMsFromSeconds = (sec?: number | null): number =>
  typeof sec === 'number' && Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : 0;

/** True when enough (de-duplicated, one-per-user) reports exist that a moderator should LOOK at the video. Never changes distribution by itself. */
export const needsModeratorReview = (s: Pick<VideoStats, 'reports'>, c: Pick<DistributionConfig, 'reportsToRestrict'>): boolean =>
  s.reports >= c.reportsToRestrict;

/**
 * Best-effort language of a caption/title from its script: 'bn' (Bengali script) or 'en' (Latin). Anything else/too short
 * -> undefined (no signal). Heuristic only; it is stored as an OPTIONAL ranking hint and never gates distribution.
 */
export function detectContentLanguage(text: string): 'bn' | 'en' | undefined {
  const t = String(text || '');
  const bn = (t.match(/[\u0980-\u09FF]/g) || []).length;
  const en = (t.match(/[A-Za-z]/g) || []).length;
  if (bn + en < 8) return undefined;
  if (bn >= en * 1.5) return 'bn';
  if (en >= bn * 1.5) return 'en';
  return undefined;
}

/** Viewer language from the browser's UI language (read locally, never stored or sent anywhere). */
export function viewerLanguageFromBrowser(): 'bn' | 'en' | undefined {
  try {
    const l = (typeof navigator !== 'undefined' ? navigator.language || '' : '').toLowerCase();
    if (l.startsWith('bn')) return 'bn';
    if (l.startsWith('en')) return 'en';
  } catch { /* ignore */ }
  return undefined;
}
