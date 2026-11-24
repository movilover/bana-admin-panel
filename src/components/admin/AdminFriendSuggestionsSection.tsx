import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Users } from 'lucide-react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { AdminCard } from '@/src/components/admin/AdminShared';
import {
  SIGNAL_KEYS,
  SIGNAL_LABELS,
  normalizeSuggestionConfig,
  resetSuggestionConfigCache,
  type SuggestionConfig,
} from '@/src/lib/friendSuggestions';

interface Props {
  currentUid: string;
  canEdit: boolean;
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
}

interface DayStat {
  day: string;
  impressions: number; requestsSent: number; dismissals: number; errors: number; emptyResults: number;
  runs: number; cacheHits: number; totalLatencyMs: number; candidatesEvaluated: number; lastError?: string;
}

const box = 'rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-[#1877F2] w-full';
const n = (v: any) => (typeof v === 'number' ? v : 0);

export function AdminFriendSuggestionsSection({ currentUid, canEdit, onWriteAudit, onNotifyAction }: Props) {
  const [cfg, setCfg] = useState<SuggestionConfig | null>(null);
  const [stats, setStats] = useState<DayStat[]>([]);
  const [statsError, setStatsError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'friendSuggestionConfig', 'settings'))
      .then((s) => setCfg(normalizeSuggestionConfig(s.exists() ? s.data() : null)))
      .catch(() => setCfg(normalizeSuggestionConfig(null)));
    // Per-user docs (<day>_<uid>) are summed per day here. Client-reported => approximate; capped to the newest 1000 user-day records.
    getDocs(query(collection(db, 'friendSuggestionStats'), orderBy('day', 'desc'), limit(1000)))
      .then((snap) => {
        const byDay = new Map<string, DayStat>();
        snap.docs.forEach((d) => {
          const x: any = d.data();
          const day = String(x.day || d.id.slice(0, 8));
          const cur = byDay.get(day) || ({ day, impressions: 0, requestsSent: 0, dismissals: 0, errors: 0, emptyResults: 0, runs: 0, cacheHits: 0, totalLatencyMs: 0, candidatesEvaluated: 0 } as DayStat);
          (['impressions', 'requestsSent', 'dismissals', 'errors', 'emptyResults', 'runs', 'cacheHits', 'totalLatencyMs', 'candidatesEvaluated'] as const).forEach((k) => { cur[k] += n(x[k]); });
          if (x.lastError) cur.lastError = x.lastError;
          byDay.set(day, cur);
        });
        setStats(Array.from(byDay.values()).sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14));
      })
      .catch(() => setStatsError(true));
  }, []);

  const totals = useMemo(() => {
    const t = { impressions: 0, requestsSent: 0, dismissals: 0, errors: 0, runs: 0, cacheHits: 0, latency: 0, empty: 0 };
    stats.forEach((s) => {
      t.impressions += n(s.impressions); t.requestsSent += n(s.requestsSent); t.dismissals += n(s.dismissals);
      t.errors += n(s.errors); t.runs += n(s.runs); t.cacheHits += n(s.cacheHits); t.latency += n(s.totalLatencyMs); t.empty += n(s.emptyResults);
    });
    return t;
  }, [stats]);

  if (!cfg) return <AdminCard className="p-5 text-sm text-neutral-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</AdminCard>;

  const num = (key: keyof SuggestionConfig, label: string, min: number, max: number) => (
    <div>
      <label className="block text-xs font-medium mb-1" htmlFor={`fs-${key}`}>{label}</label>
      <input
        id={`fs-${key}`} type="number" min={min} max={max} disabled={!canEdit} className={box}
        value={cfg[key] as number}
        onChange={(e) => setCfg({ ...cfg, [key]: Math.round(Number(e.target.value)) } as SuggestionConfig)}
      />
    </div>
  );

  const save = async () => {
    const clean = normalizeSuggestionConfig(cfg); // clamps every value to the same bounds the rules enforce
    setSaving(true);
    try {
      await setDoc(doc(db, 'friendSuggestionConfig', 'settings'), {
        enabled: clean.enabled, feedEnabled: clean.feedEnabled, feedFirstAfter: clean.feedFirstAfter,
        feedEveryN: clean.feedEveryN, cardsPerSlot: clean.cardsPerSlot, maxSlots: clean.maxSlots,
        cacheTtlMinutes: clean.cacheTtlMinutes, maxFriendsSampled: clean.maxFriendsSampled, maxCandidates: clean.maxCandidates,
        weights: clean.weights, signals: clean.signals, updatedBy: currentUid, updatedAt: serverTimestamp(),
      });
      resetSuggestionConfigCache();
      setCfg(clean);
      await onWriteAudit('friend_suggestions_config_updated', 'friendSuggestionConfig', 'settings',
        `Suggestions ${clean.enabled ? 'on' : 'off'}; feed ${clean.feedEnabled ? 'on' : 'off'}; first after ${clean.feedFirstAfter}, every ${clean.feedEveryN} posts; signals: ${SIGNAL_KEYS.filter((k) => clean.signals[k]).join(', ') || 'none'}`);
      onNotifyAction('Friend Suggestions settings saved.');
    } catch (e: any) {
      onNotifyAction(e?.code === 'permission-denied' ? 'Only Admin / Super Admin can change these settings.' : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  const ctr = totals.impressions ? ((totals.requestsSent / totals.impressions) * 100).toFixed(1) : '—';
  const avgMs = totals.runs ? Math.round(totals.latency / totals.runs) : 0;

  return (
    <div className="space-y-4">
      <AdminCard className="p-4 sm:p-5 space-y-5">
        <div>
          <h2 className="font-display font-bold text-lg flex items-center gap-2"><Users className="w-5 h-5 text-[#1877F2]" /> Friend Suggestions</h2>
          <p className="text-xs text-neutral-500">
            Uses only public profile data, community membership and the viewer’s own friend graph. Messages, private posts and uploaded
            contacts are never used. No per-user suggestion data is shown here.
          </p>
        </div>

        <div className="flex flex-wrap gap-5 text-sm font-semibold">
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} /> Friend Suggestions enabled</label>
          <label className="flex items-center gap-2"><input type="checkbox" disabled={!canEdit} checked={cfg.feedEnabled} onChange={(e) => setCfg({ ...cfg, feedEnabled: e.target.checked })} /> Show in News Feed</label>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {num('feedFirstAfter', 'First slot after N posts', 1, 50)}
          {num('feedEveryN', 'Then every N posts', 3, 100)}
          {num('cardsPerSlot', 'Cards per slot', 2, 12)}
          {num('maxSlots', 'Max slots per feed', 0, 10)}
          {num('cacheTtlMinutes', 'Cache (minutes)', 1, 240)}
          {num('maxFriendsSampled', 'Friends sampled', 1, 20)}
          {num('maxCandidates', 'Max candidates read', 10, 120)}
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Signals &amp; ranking weights (0–100)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {SIGNAL_KEYS.map((k) => (
              <div key={k} className="flex items-center gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2">
                <input type="checkbox" aria-label={`Enable ${SIGNAL_LABELS[k]}`} disabled={!canEdit} checked={cfg.signals[k]}
                  onChange={(e) => setCfg({ ...cfg, signals: { ...cfg.signals, [k]: e.target.checked } })} />
                <span className="flex-1 text-xs">{SIGNAL_LABELS[k]}</span>
                <input type="number" min={0} max={100} aria-label={`${SIGNAL_LABELS[k]} weight`} disabled={!canEdit || !cfg.signals[k]}
                  className="w-16 rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-2 py-1 text-sm"
                  value={cfg.weights[k]}
                  onChange={(e) => setCfg({ ...cfg, weights: { ...cfg.weights, [k]: Math.round(Number(e.target.value)) } })} />
              </div>
            ))}
          </div>
        </div>

        {canEdit ? (
          <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 inline-flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save settings
          </button>
        ) : <p className="text-xs text-neutral-500">Read-only for your role.</p>}
      </AdminCard>

      <AdminCard className="p-4 sm:p-5 space-y-3">
        <h3 className="font-display font-semibold text-sm">Activity &amp; health (last 14 days) — client-reported, approximate counters</h3>
        {statsError ? <p className="text-xs text-red-600">Could not load stats.</p> : stats.length === 0 ? (
          <p className="text-xs text-neutral-500">No activity recorded yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              {[
                ['Cards shown', totals.impressions], ['Requests sent', totals.requestsSent], ['Request rate', ctr === '—' ? ctr : `${ctr}%`], ['Dismissals', totals.dismissals],
                ['Generations', totals.runs], ['Cache hits', totals.cacheHits], ['Avg generation', `${avgMs} ms`], ['Errors', totals.errors],
              ].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2.5">
                  <p className="text-base font-bold">{v}</p><p className="text-[11px] text-neutral-500">{k}</p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs min-w-[520px]">
                <thead><tr className="text-left text-neutral-500"><th className="py-1">Day</th><th>Shown</th><th>Requests</th><th>Dismissed</th><th>Empty</th><th>Errors</th><th>Last error</th></tr></thead>
                <tbody>
                  {stats.map((s) => (
                    <tr key={s.day} className="border-t border-neutral-100 dark:border-neutral-800">
                      <td className="py-1.5">{s.day.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}</td>
                      <td>{n(s.impressions)}</td><td>{n(s.requestsSent)}</td><td>{n(s.dismissals)}</td><td>{n(s.emptyResults)}</td>
                      <td className={n(s.errors) ? 'text-red-600 font-semibold' : ''}>{n(s.errors)}</td>
                      <td className="max-w-[160px] truncate text-neutral-500">{s.lastError || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <p className="text-[11px] text-neutral-400">Counters are reported by clients in batches, so they are indicative, not an exact audit.</p>
      </AdminCard>
    </div>
  );
}
