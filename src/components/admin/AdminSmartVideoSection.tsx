import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Video } from 'lucide-react';
import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, startAfter, Timestamp, where,
  type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { setVideoDistributionStatus } from '@/src/lib/videoModeration';
import { db } from '@/src/firebase';
import { AdminCard } from '@/src/components/admin/AdminShared';
import {
  CONFIG_INT_BOUNDS, WEIGHT_KEYS, computeMetrics, deriveStage, getDistributionConfig, normalizeDistributionConfig,
  normalizeStats, resetDistributionConfigCache, suspicionFlags, toStatsKeyParts,
  type ContentLite, type DistributionConfig, type VideoStats,
} from '@/src/lib/videoDistribution';

interface Props {
  currentUid: string;
  canEditSettings: boolean;
  canModerate: boolean;
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
}
type Tab = 'settings' | 'activity' | 'flagged' | 'controls';
type DistStatus = 'auto' | 'paused' | 'stopped' | 'under_review' | 'restricted';
interface StatRow { key: string; ownerId: string; contentType: 'reel' | 'post'; contentId: string; createdMs: number; stats: VideoStats; distReason?: string }

const box = 'rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-[#1877F2] w-full';
const LABELS: Record<string, string> = {
  validMinWatchMs: 'Valid view: min watch (ms)', validMinPercent: 'Valid view: OR % of video watched', completionPercent: 'Completion point (% watched)',
  skipMs: 'Skip: ends before (ms)', stage1Audience: 'Stage 1 audience (unique viewers)', stage2Audience: 'Stage 2 audience', stage3Audience: 'Stage 3 audience',
  audienceSampleRate: 'Audience sample rate (%)', stageMinRelevance: 'Min relevance in stages 1-3 (0-100)', evalMinValidViews: 'Min valid views to evaluate',
  evalWindowHours: 'Evaluation window (hours)', minAvgWatchPercent: 'Min avg watch (% of video)', minCompletionPercent: 'Min completion rate (%)',
  minEngagementPercent: 'Min engagement per valid view (%)', maxSkipPercent: 'Max skip rate (%)', maxNegativePercent: 'Max negative feedback (%)',
  reportsToRestrict: 'Reports that block expansion', minDurationSec: 'Min video length (s)', newCreatorMaxFollowers: 'New creator: max followers',
  newCreatorSlotPercent: 'New creator slots per page (%)', maxPerCreatorPerPage: 'Max videos per creator per page', freshnessHalfLifeHours: 'Freshness half-life (h)',
  priorStrength: 'Smoothing strength (virtual views)', recentPoolSize: 'Candidate pool: recent videos', topPoolSize: 'Candidate pool: top performers', feedCacheMinutes: 'Cache (minutes)',
};
const GROUPS: Array<[string, string[]]> = [
  ['What counts as a view', ['validMinWatchMs', 'validMinPercent', 'completionPercent', 'skipMs']],
  ['Progressive stages', ['stage1Audience', 'stage2Audience', 'stage3Audience', 'audienceSampleRate', 'stageMinRelevance', 'evalMinValidViews', 'evalWindowHours']],
  ['Evaluation thresholds', ['minAvgWatchPercent', 'minCompletionPercent', 'minEngagementPercent', 'maxSkipPercent', 'maxNegativePercent', 'reportsToRestrict']],
  ['Quality minimums', ['minDurationSec']],
  ['New creators & diversity', ['newCreatorMaxFollowers', 'newCreatorSlotPercent', 'maxPerCreatorPerPage', 'freshnessHalfLifeHours', 'priorStrength']],
  ['Cost controls (Firestore reads)', ['recentPoolSize', 'topPoolSize', 'feedCacheMinutes']],
];

export function AdminSmartVideoSection({ currentUid, canEditSettings, canModerate, onWriteAudit, onNotifyAction }: Props) {
  const [tab, setTab] = useState<Tab>('activity');
  const [cfg, setCfg] = useState<DistributionConfig | null>(null);
  const [rows, setRows] = useState<StatRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lookup, setLookup] = useState('');
  // Server-side filters + cursor pagination (replaces the old fixed 150-row window)
  const [statusFilter, setStatusFilter] = useState<'all' | 'reported' | DistStatus>('all');
  const [creatorInput, setCreatorInput] = useState('');
  const [creatorUid, setCreatorUid] = useState<string | null>(null);
  const [fromD, setFromD] = useState('');
  const [toD, setToD] = useState('');
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reason, setReason] = useState('');

  const PAGE = 50;
  const toRow = (d: QueryDocumentSnapshot): StatRow => {
    const x: any = d.data();
    return { key: d.id, ownerId: x.ownerId, contentType: x.contentType, contentId: x.contentId, stats: normalizeStats(x),
      createdMs: x.contentCreatedAt?.toMillis ? x.contentCreatedAt.toMillis() : 0, distReason: x.distReason };
  };
  const buildConstraints = useCallback((threshold: number): QueryConstraint[] => {
    const c: QueryConstraint[] = [];
    if (creatorUid) c.push(where('ownerId', '==', creatorUid));
    if (statusFilter === 'reported') {
      c.push(where('reports', '>=', Math.max(1, threshold)));
      c.push(orderBy('reports', 'desc'));
      return c; // range on reports: date filters are not combined here (Firestore allows one range field)
    }
    if (statusFilter !== 'all') c.push(where('distStatus', '==', statusFilter));
    if (fromD) c.push(where('updatedAt', '>=', Timestamp.fromDate(new Date(`${fromD}T00:00:00`))));
    if (toD) c.push(where('updatedAt', '<=', Timestamp.fromDate(new Date(`${toD}T23:59:59.999`))));
    c.push(orderBy('updatedAt', 'desc'));
    return c;
  }, [creatorUid, statusFilter, fromD, toD]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const conf = await getDistributionConfig(true);
      setCfg(conf);
      const snap = await getDocs(query(collection(db, 'videoStats'), ...buildConstraints(conf.reportsToRestrict), limit(PAGE)));
      setRows(snap.docs.map(toRow));
      setCursor(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
      setHasMore(snap.docs.length >= PAGE);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildConstraints]);

  const loadMore = async () => {
    if (!cursor || !cfg || loadingMore) return;
    setLoadingMore(true);
    try {
      const snap = await getDocs(query(collection(db, 'videoStats'), ...buildConstraints(cfg.reportsToRestrict), startAfter(cursor), limit(PAGE)));
      setRows((prev) => [...prev, ...snap.docs.map(toRow)]);
      setCursor(snap.docs.length ? snap.docs[snap.docs.length - 1] : cursor);
      setHasMore(snap.docs.length >= PAGE);
    } catch { onNotifyAction('Could not load more videos.'); } finally { setLoadingMore(false); }
  };

  // Creator filter: resolve @username -> uid (exact match on the public profile), then filter videoStats by ownerId server-side.
  const applyCreator = async () => {
    const q = creatorInput.trim().replace(/^@/, '').toLowerCase();
    if (!q) { setCreatorUid(null); return; }
    const snap = await getDocs(query(collection(db, 'users'), where('username', '==', q), limit(1))).catch(() => null);
    if (snap && !snap.empty) setCreatorUid(snap.docs[0].id);
    else if (/^[A-Za-z0-9]{20,}$/.test(creatorInput.trim())) setCreatorUid(creatorInput.trim()); // a raw uid
    else onNotifyAction('No creator with that username.');
  };

  // Exact video lookup by key (advanced): fetches that one stats doc and selects it.
  const lookupKey = async (key: string) => {
    const k = key.trim();
    if (!k) return;
    const snap = await getDoc(doc(db, 'videoStats', k)).catch(() => null);
    if (snap?.exists()) { setRows((prev) => [toRow(snap as any), ...prev.filter((r) => r.key !== k)]); setLookup(k); }
    else onNotifyAction('No stats yet for that video key (videos appear here after their first view or feedback).');
  };
  useEffect(() => { void load(); }, [load]);

  const lite = (r: StatRow): ContentLite => ({ key: r.key, authorId: r.ownerId, createdMs: r.createdMs || Date.now(), durationMs: 0 /* unknown in admin list: duration-dependent checks are skipped, not guessed */, likes: 0, comments: 0, shares: 0, saves: 0, processingReady: true });
  const derived = useMemo(() => (cfg ? rows.map((r) => {
    const c = lite(r);
    return { r, st: deriveStage(r.stats, c, cfg, Date.now()), m: computeMetrics(r.stats, c), flags: suspicionFlags(r.stats, c) };
  }) : []), [rows, cfg]);

  const summary = useMemo(() => {
    const stages = { 1: 0, 2: 0, 3: 0, 4: 0, 0: 0 } as Record<number, number>;
    let plays = 0, valid = 0, completion = 0, skip = 0, neg = 0, n = 0;
    derived.forEach(({ r, st, m }) => {
      stages[st.stage]++; plays += r.stats.plays; valid += r.stats.validViews;
      if (r.stats.plays > 0) { completion += m.completionRate; skip += m.skipRate; neg += m.negativeRate; n++; }
    });
    return { stages, plays, valid, completion: n ? completion / n : 0, skip: n ? skip / n : 0, neg: n ? neg / n : 0, videos: derived.length };
  }, [derived]);

  const flagged = derived.filter(({ r, flags }) => flags.length > 0 || r.stats.reports > 0 || (r.stats.distStatus && r.stats.distStatus !== 'auto'));

  const save = async () => {
    if (!cfg) return;
    const clean = normalizeDistributionConfig(cfg);
    setSaving(true);
    try {
      const { updatedAt: _u, updatedBy: _b, ...rest } = clean as any;
      await setDoc(doc(db, 'videoDistributionConfig', 'settings'), { ...rest, updatedBy: currentUid, updatedAt: serverTimestamp() });
      resetDistributionConfigCache();
      setCfg(clean);
      await onWriteAudit('video_distribution_config_updated', 'videoDistributionConfig', 'settings',
        `Distribution ${clean.enabled ? 'on' : 'off'}; progressive ${clean.progressiveEnabled ? 'on' : 'off'}; stages ${clean.stage1Audience}/${clean.stage2Audience}/${clean.stage3Audience}`);
      onNotifyAction('Smart Video Distribution settings saved.');
    } catch (e: any) {
      onNotifyAction(e?.code === 'permission-denied' ? 'Only Admin / Super Admin can change these settings.' : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (key: string, status: DistStatus) => {
    if (status !== 'auto' && reason.trim().length < 3) return onNotifyAction('Enter a reason (3+ characters) first.');
    try {
      const { type, id } = toStatsKeyParts(key);
      const content = await getDoc(doc(db, type === 'reel' ? 'reels' : 'posts', id));
      if (!content.exists()) return onNotifyAction('Video not found.');
      const c: any = content.data();
      // One batch: private stats (reason + actor) + public ranking status + append-only log; rules tie them together.
      await setVideoDistributionStatus({ type, id, authorId: c.authorId, createdAt: c.createdAt }, status, reason, currentUid, `set_${status}`);
      await onWriteAudit('video_distribution_status_changed', type === 'reel' ? 'reel' : 'post', id, `Distribution set to ${status}: ${reason.trim().slice(0, 150)}`);
      onNotifyAction(`Distribution set to ${status}.`);
      setReason('');
      await load();
    } catch (e: any) {
      onNotifyAction(e?.code === 'permission-denied' ? 'Not permitted.' : 'Could not update this video.');
    }
  };

  if (!cfg && loading) return <AdminCard className="p-5 text-sm text-neutral-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</AdminCard>;
  if (!cfg) return <AdminCard className="p-5 text-sm text-red-600">Could not load settings.</AdminCard>;

  const tabs: Array<[Tab, string]> = [['activity', 'Activity & performance'], ['flagged', `Flagged (${flagged.length})`], ['controls', 'Video controls'], ['settings', 'Settings']];

  return (
    <AdminCard className="p-4 sm:p-5 space-y-4">
      <div>
        <h2 className="font-display font-bold text-lg flex items-center gap-2"><Video className="w-5 h-5 text-[#1877F2]" /> Smart Video Distribution</h2>
        <p className="text-xs text-neutral-500">Counters are written by viewers’ apps but validated by database rules. Only aggregate video statistics are shown — no private messages or viewer identities.</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${tab === id ? 'bg-[#1877F2] text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'}`}>{label}</button>
        ))}
      </div>

      {tab !== 'settings' && (
        <div className="flex flex-wrap gap-2" role="search" aria-label="Filter videos">
          <select className={box + ' !w-auto'} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} aria-label="Distribution status">
            <option value="all">All statuses</option>
            <option value="reported">Needs moderator review (reports ≥ threshold)</option>
            {(['auto', 'paused', 'stopped', 'under_review', 'restricted'] as DistStatus[]).map((x) => <option key={x} value={x}>{x.replace('_', ' ')}</option>)}
          </select>
          <input className={box + ' !w-44'} placeholder="Creator @username" value={creatorInput} onChange={(e) => setCreatorInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void applyCreator(); }} onBlur={() => void applyCreator()} aria-label="Filter by creator" />
          <input type="date" className={box + ' !w-auto'} value={fromD} onChange={(e) => setFromD(e.target.value)} aria-label="Active from" disabled={statusFilter === 'reported'} />
          <input type="date" className={box + ' !w-auto'} value={toD} onChange={(e) => setToD(e.target.value)} aria-label="Active to" disabled={statusFilter === 'reported'} />
        </div>
      )}

      {tab === 'settings' && (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-5 text-sm font-semibold">
            {([['enabled', 'Recommendation distribution enabled'], ['progressiveEnabled', 'Progressive (staged) distribution'], ['newCreatorEnabled', 'New-creator exploration'], ['requireProcessingReady', 'Require finished processing']] as const).map(([k, l]) => (
              <label key={k} className="flex items-center gap-2"><input type="checkbox" disabled={!canEditSettings} checked={cfg[k]} onChange={(e) => setCfg({ ...cfg, [k]: e.target.checked })} /> {l}</label>
            ))}
          </div>
          {GROUPS.map(([title, keys]) => (
            <div key={title}>
              <h3 className="text-sm font-semibold mb-2">{title}</h3>
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {keys.map((k) => (
                  <div key={k}>
                    <label className="block text-xs font-medium mb-1" htmlFor={`sv-${k}`}>{LABELS[k]}</label>
                    <input id={`sv-${k}`} type="number" disabled={!canEditSettings} min={CONFIG_INT_BOUNDS[k][0]} max={CONFIG_INT_BOUNDS[k][1]} className={box}
                      value={(cfg as any)[k]} onChange={(e) => setCfg({ ...cfg, [k]: Math.round(Number(e.target.value)) } as DistributionConfig)} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div>
            <h3 className="text-sm font-semibold mb-2">Ranking weights (0–100; penalties subtract)</h3>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
              {WEIGHT_KEYS.map((k) => (
                <div key={k}>
                  <label className="block text-xs font-medium mb-1" htmlFor={`svw-${k}`}>{k}</label>
                  <input id={`svw-${k}`} type="number" min={0} max={100} disabled={!canEditSettings} className={box} value={cfg.weights[k]}
                    onChange={(e) => setCfg({ ...cfg, weights: { ...cfg.weights, [k]: Math.round(Number(e.target.value)) } })} />
                </div>
              ))}
            </div>
          </div>
          {canEditSettings ? (
            <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 inline-flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save settings
            </button>
          ) : <p className="text-xs text-neutral-500">Read-only for your role.</p>}
          <p className="text-[11px] text-neutral-400">Clients cache settings for up to 5 minutes. Stage sizes are always kept strictly increasing.</p>
        </div>
      )}

      {tab === 'activity' && (
        error ? <p className="text-sm text-red-600">Could not load activity.</p> : rows.length === 0 ? <p className="text-sm text-neutral-500">No video activity recorded yet.</p> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[['Videos tracked', summary.videos], ['Plays', summary.plays], ['Valid views', summary.valid], ['Avg completion', `${(summary.completion * 100).toFixed(1)}%`],
                ['Avg skip rate', `${(summary.skip * 100).toFixed(1)}%`], ['Avg negative rate', `${(summary.neg * 100).toFixed(1)}%`],
                ['Stage 1-3 (testing)', summary.stages[1] + summary.stages[2] + summary.stages[3]], ['Stage 4 / blocked', `${summary.stages[4]} / ${summary.stages[0]}`]].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2.5"><p className="text-base font-bold">{v}</p><p className="text-[11px] text-neutral-500">{k}</p></div>
              ))}
            </div>
            <VideoTable rows={derived} />
            <p className="text-[11px] text-neutral-400">Showing {rows.length} videos for the current filters (newest activity first).</p>
          </div>
        )
      )}

      {tab !== 'settings' && hasMore && (
        <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-semibold disabled:opacity-60">
          {loadingMore ? 'Loading…' : `Load next ${PAGE} videos`}
        </button>
      )}

      {tab === 'flagged' && (flagged.length === 0 ? <p className="text-sm text-neutral-500">Nothing flagged.</p> : <VideoTable rows={flagged} showFlags />)}

      {tab === 'controls' && (
        <div className="space-y-3">
          {!canModerate && <p className="text-xs text-neutral-500">Read-only for your role.</p>}
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-700 p-3 text-xs">
            {lookup ? (
              <p>Selected video: <span className="font-mono font-semibold">{lookup}</span>{' '}
                <button type="button" className="underline text-[#1877F2]" onClick={() => setLookup('')}>clear</button></p>
            ) : <p className="text-neutral-500">Pick a video from the list below (use the filters above), or look one up by key.</p>}
          </div>
          <div className="flex gap-2">
            <input className={box} placeholder="Advanced: video key (reel id, or post_<postId>)" aria-label="Look up by video key"
              onKeyDown={(e) => { if (e.key === 'Enter') void lookupKey((e.target as HTMLInputElement).value); }} />
          </div>
          {rows.length === 0 ? <p className="text-sm text-neutral-500">No videos match these filters.</p> : <VideoTable rows={derived} showFlags />}
          <input className={box} placeholder="Reason (required to pause / stop / review / restrict)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />
          <div className="flex flex-wrap gap-2">
            {(['paused', 'stopped', 'under_review', 'restricted', 'auto'] as DistStatus[]).map((s) => (
              <button key={s} type="button" disabled={!canModerate || !lookup} onClick={() => setStatus(lookup, s)}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-40 ${s === 'auto' ? 'border border-neutral-200 dark:border-neutral-700' : s === 'stopped' ? 'bg-red-600 text-white' : 'bg-[#1877F2] text-white'}`}>
                {s === 'auto' ? 'Resume (auto)' : s.replace('_', ' ')}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500">Paused/stopped: not recommended to anyone. Under review: never expands beyond stage 1. Restricted: followers only. Every change is written to the moderation log and the audit log.</p>
        </div>
      )}
    </AdminCard>
  );

  function VideoTable({ rows: list, showFlags }: { rows: typeof derived; showFlags?: boolean }) {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[640px]">
          <thead><tr className="text-left text-neutral-500"><th className="py-1">Video</th><th>Stage</th><th>Plays</th><th>Valid</th><th>Unique</th><th>Compl.</th><th>Skip</th><th>Reports</th>{showFlags && <th>Flags</th>}</tr></thead>
          <tbody>
            {list.map(({ r, st, m, flags }) => (
              <tr key={r.key} aria-selected={lookup === r.key} className={`border-t border-neutral-100 dark:border-neutral-800 cursor-pointer ${lookup === r.key ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`} onClick={() => { setLookup(r.key); setTab('controls'); }}>
                <td className="py-1.5 font-mono max-w-[140px] truncate">{r.key}</td>
                <td>{st.stage ? `S${st.stage}` : '—'} {st.status.replace('_', ' ')}</td>
                <td>{r.stats.plays}</td><td>{r.stats.validViews}</td><td>{r.stats.uniqueViewers}</td>
                <td>{(m.completionRate * 100).toFixed(0)}%</td><td>{(m.skipRate * 100).toFixed(0)}%</td>
                <td className={r.stats.reports ? 'text-red-600 font-semibold' : ''}>{r.stats.reports}</td>
                {showFlags && <td className="text-amber-700">{flags.join(', ') || (r.stats.distStatus !== 'auto' ? r.stats.distStatus : '—')}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
}
