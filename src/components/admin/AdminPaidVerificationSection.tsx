import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Loader2, Search, Settings2 } from 'lucide-react';
import {
  collection, getCountFromServer, getDocs, limit, onSnapshot, orderBy, query, startAfter, Timestamp, where,
  type QueryConstraint, type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { AdminCard, AdminPagination } from '@/src/components/admin/AdminShared';
import { VerificationStatusPill } from '@/src/components/verification/VerificationStatusPill';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import {
  approveApplication,
  formatMoney,
  normalizeConfig,
  rejectApplication,
  revokeProfileOnly,
  revokeVerification,
  saveVerificationConfig,
  startReview,
  subscribeVerificationConfig,
  toMillis,
} from '@/src/lib/paidVerification';
import {
  PAYMENT_METHOD_IDS,
  PAYMENT_METHOD_LABELS,
  STATUS_LABELS,
  type PaidVerificationApplication,
  type PaymentMethodId,
  type VerificationConfig,
} from '@/src/types/paidVerification';

type View = 'all' | 'pending' | 'review' | 'verified' | 'rejected' | 'settings';

interface Props {
  currentUid: string;
  canManage: boolean; // approve / reject / revoke
  canEditSettings: boolean; // Super Admin only
  actorEmail?: string;
  actorRole?: string;
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
  onAskConfirm: (cfg: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    action: () => Promise<void>;
  }) => void;
}

const PAGE_SIZE = 10;
const FETCH_SIZE = 50; // server page size (cursor pagination; 'Load more' fetches the next page)
const SEARCH_CAP = 25; // per search query
const field =
  'rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-[#1877F2]';

const fmtDate = (v: any) => (toMillis(v) ? new Date(toMillis(v)).toLocaleString() : '—');

export function AdminPaidVerificationSection({
  currentUid,
  canManage,
  canEditSettings,
  actorEmail,
  actorRole,
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: Props) {
  // Audit records are staged in the same atomic batch as each status change (see paidVerification.ts).
  const auditCtx = { actorEmail, actorRole };
  const [view, setView] = useState<View>('pending');
  type App = PaidVerificationApplication;
  const [firstPage, setFirstPage] = useState<App[]>([]);      // live (onSnapshot) newest page for the current filters
  const [morePages, setMorePages] = useState<App[]>([]);      // pages fetched with startAfter(cursor)
  const [cursor, setCursor] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchHits, setSearchHits] = useState<App[] | null>(null);
  const [verifiedApps, setVerifiedApps] = useState<App[]>([]);
  const [counts, setCounts] = useState({ pending: 0, review: 0 });
  const [verifiedUsers, setVerifiedUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState<'' | PaymentMethodId>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const statuses: string[] | null =
    view === 'pending' ? ['payment_pending'] : view === 'review' ? ['under_review'] : view === 'verified' ? ['verified']
    : view === 'rejected' ? ['rejected', 'revoked'] : null;

  // Server-side filters (status / method / date range). Composite indexes: see firestore.indexes.json.
  const constraints = useMemo(() => {
    const c: QueryConstraint[] = [];
    if (statuses) c.push(statuses.length === 1 ? where('status', '==', statuses[0]) : where('status', 'in', statuses));
    if (methodFilter) c.push(where('method', '==', methodFilter));
    if (from) c.push(where('createdAt', '>=', Timestamp.fromDate(new Date(`${from}T00:00:00`))));
    if (to) c.push(where('createdAt', '<=', Timestamp.fromDate(new Date(`${to}T23:59:59.999`))));
    c.push(orderBy('createdAt', 'desc'));
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, methodFilter, from, to]);

  useEffect(() => {
    if (view === 'settings') return;
    setLoading(true);
    setError(null);
    setMorePages([]);
    const off = onSnapshot(
      query(collection(db, 'paidVerificationApplications'), ...constraints, limit(FETCH_SIZE)),
      (snap) => {
        setFirstPage(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<App, 'id'>) })));
        setCursor(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
        setHasMore(snap.docs.length >= FETCH_SIZE);
        setLoading(false);
      },
      (err: any) => {
        setError(
          err?.code === 'failed-precondition'
            ? 'This filter needs a Firestore index. Deploy firestore.indexes.json (firebase deploy --only firestore:indexes) and retry.'
            : 'Could not load applications. You may not have permission.'
        );
        setLoading(false);
      }
    );
    return off;
  }, [constraints, view]);

  // Verified users + their paid applications (for the Verified list / revocation); independent of the active filters.
  useEffect(() => {
    const offVerifiedApps = onSnapshot(
      query(collection(db, 'paidVerificationApplications'), where('status', '==', 'verified'), orderBy('createdAt', 'desc'), limit(200)),
      (snap) => setVerifiedApps(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<App, 'id'>) }))),
      () => {}
    );
    const offUsers = onSnapshot(
      query(collection(db, 'users'), where('isVerified', '==', true), limit(200)),
      (snap) => setVerifiedUsers(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))),
      () => {}
    );
    return () => { offVerifiedApps(); offUsers(); };
  }, []);

  // Tab counters via server-side aggregation (cheap count queries, no document reads of the whole list).
  useEffect(() => {
    const col = collection(db, 'paidVerificationApplications');
    Promise.all([
      getCountFromServer(query(col, where('status', '==', 'payment_pending'))),
      getCountFromServer(query(col, where('status', '==', 'under_review'))),
    ]).then(([p, r]) => setCounts({ pending: p.data().count, review: r.data().count })).catch(() => {});
  }, [busy]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const snap = await getDocs(query(collection(db, 'paidVerificationApplications'), ...constraints, startAfter(cursor), limit(FETCH_SIZE)));
      setMorePages((prev) => [...prev, ...snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<App, 'id'>) }))]);
      setCursor(snap.docs.length ? snap.docs[snap.docs.length - 1] : cursor);
      setHasMore(snap.docs.length >= FETCH_SIZE);
    } catch {
      setError('Could not load more applications.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Server-side search (debounced): exact uid / transaction id / sender number, and username PREFIX. Case: usernames are
  // stored lower-case; transaction ids are matched as typed and upper-cased.
  useEffect(() => {
    const q = search.trim().replace(/^@/, '');
    if (q.length < 2) { setSearchHits(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      const col = collection(db, 'paidVerificationApplications');
      const lower = q.toLowerCase();
      const runQ = (...c: QueryConstraint[]) => getDocs(query(col, ...c, limit(SEARCH_CAP))).catch(() => null);
      const snaps = await Promise.all([
        runQ(where('uid', '==', q)),
        runQ(where('transactionId', '==', q)),
        runQ(where('transactionId', '==', q.toUpperCase())),
        runQ(where('senderNumber', '==', q)),
        runQ(where('username', '>=', lower), where('username', '<=', `${lower}\uf8ff`)),
      ]);
      if (cancelled) return;
      const m = new Map<string, App>();
      snaps.forEach((sn) => sn?.docs.forEach((d) => m.set(d.id, { id: d.id, ...(d.data() as Omit<App, 'id'>) })));
      setSearchHits(Array.from(m.values()).sort((x, y) => toMillis(y.createdAt) - toMillis(x.createdAt)));
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  useEffect(() => setPage(1), [view, search, methodFilter, from, to]);

  const appByUid = useMemo(() => {
    const m = new Map<string, App>();
    for (const a of verifiedApps) if (!m.has(a.uid)) m.set(a.uid, a);
    return m;
  }, [verifiedApps]);

  // Search hits are filtered by the same view / method / date controls (client-side, on at most a few dozen rows).
  const filtered = useMemo(() => {
    if (searchHits === null) {
      const seen = new Set(firstPage.map((a) => a.id));
      return [...firstPage, ...morePages.filter((a) => !seen.has(a.id))];
    }
    const fromMs = from ? new Date(`${from}T00:00:00`).getTime() : 0;
    const toMs = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
    return searchHits.filter((a) => {
      if (statuses && !statuses.includes(a.status)) return false;
      if (methodFilter && a.method !== methodFilter) return false;
      const t = toMillis(a.createdAt);
      return t >= fromMs && t <= toMs;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstPage, morePages, searchHits, view, methodFilter, from, to]);

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const run = async (fn: () => Promise<void>, doneMsg: string) => {
    setBusy(true);
    try {
      await fn();
      onNotifyAction(doneMsg);
      setReason('');
    } catch (e: any) {
      onNotifyAction(
        e?.code === 'permission-denied'
          ? 'Action denied: this application changed or you lack permission. Refresh and retry.'
          : e?.message || 'Action failed.'
      );
    } finally {
      setBusy(false);
    }
  };

  const tabs: Array<{ id: View; label: string; badge?: number }> = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending', badge: counts.pending },
    { id: 'review', label: 'Under review', badge: counts.review },
    { id: 'verified', label: 'Verified users' },
    { id: 'rejected', label: 'Rejected' },
    ...(canEditSettings ? [{ id: 'settings' as View, label: 'Payment settings' }] : []),
  ];

  return (
    <AdminCard className="p-4 sm:p-5 space-y-4">
      <div>
        <h2 className="font-display font-bold text-lg flex items-center gap-2">
          <BadgeCheck className="w-5 h-5 text-[#1877F2]" /> Paid Profile Verification
        </h2>
        <p className="text-xs text-neutral-500">
          Transaction IDs are unverified claims. Approve only after you have matched the payment in your own bKash / Nagad /
          Rocket records.
        </p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={view === t.id}
            type="button"
            onClick={() => setView(t.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 ${
              view === t.id ? 'bg-[#1877F2] text-white' : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
            }`}
          >
            {t.id === 'settings' && <Settings2 className="w-3.5 h-3.5" />}
            {t.label}
            {t.badge ? <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {view === 'settings' && canEditSettings ? (
        <PaymentSettingsPanel currentUid={currentUid} onWriteAudit={onWriteAudit} onNotifyAction={onNotifyAction} />
      ) : view === 'verified' ? (
        <VerifiedList
          users={verifiedUsers}
          appByUid={appByUid}
          canManage={canManage}
          busy={busy}
          onRevoke={(u, app, why) =>
            onAskConfirm({
              title: `Revoke verification for @${u.username || u.uid}?`,
              description: 'The badge is removed everywhere immediately and the user is notified with your reason.',
              confirmLabel: 'Revoke',
              variant: 'danger',
              action: () =>
                run(
                  () =>
                    app
                      ? revokeVerification(app, currentUid, why, auditCtx)
                      : revokeProfileOnly(u.uid, u.username, currentUid, why, auditCtx),
                  `Verification revoked for @${u.username || u.uid}.`
                ),
            })
          }
        />
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search @username (prefix), txn ID, number, user ID…"
                className={`${field} w-full pl-8`}
                aria-label="Search applications"
              />
            </div>
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value as any)} className={field} aria-label="Method">
              <option value="">All methods</option>
              {PAYMENT_METHOD_IDS.map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
              ))}
            </select>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} aria-label="Submitted from" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} aria-label="Submitted to" />
          </div>

          {loading ? (
            <p className="text-sm text-neutral-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>
          ) : error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : paged.length === 0 ? (
            <p className="text-sm text-neutral-500">No applications in this view.</p>
          ) : (
            <ul className="space-y-2">
              {paged.map((a) => {
                const open = openId === a.id;
                const mine = a.uid === currentUid;
                return (
                  <li key={a.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenId(open ? null : a.id);
                        setReason('');
                      }}
                      className="w-full text-left p-3 flex flex-wrap items-center justify-between gap-2"
                      aria-expanded={open}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          @{a.username || a.uid} <span className="font-normal text-neutral-500">· {a.displayName}</span>
                        </p>
                        <p className="text-[11px] text-neutral-500">
                          {PAYMENT_METHOD_LABELS[a.method]} · {formatMoney(a.amount, a.currency)} · {formatRelativeTime(a.createdAt)}
                        </p>
                      </div>
                      <VerificationStatusPill state={a.status} />
                    </button>

                    {open && (
                      <div className="border-t border-neutral-100 dark:border-neutral-800 p-3 space-y-3 text-sm">
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <Row k="Transaction ID" v={<span className="font-mono">{a.transactionId}</span>} />
                          <Row k="Method" v={PAYMENT_METHOD_LABELS[a.method]} />
                          <Row k="Sender number" v={<span className="font-mono">{a.senderNumber}</span>} />
                          <Row k="Amount" v={formatMoney(a.amount, a.currency)} />
                          <Row k="Submitted" v={fmtDate(a.createdAt)} />
                          <Row k="Approved" v={fmtDate(a.approvedAt)} />
                          <Row k="User ID" v={<span className="font-mono break-all">{a.uid}</span>} />
                          <Row k="Reviewed by" v={<span className="font-mono break-all">{a.reviewedBy || '—'}</span>} />
                          {a.reference && <Row k="User note" v={a.reference} />}
                          {a.rejectionReason && <Row k="Rejection reason" v={a.rejectionReason} />}
                          {a.revokeReason && <Row k="Revoke reason" v={a.revokeReason} />}
                        </dl>

                        <div>
                          <p className="text-xs font-semibold mb-1">History</p>
                          <ol className="space-y-1">
                            {(a.history || []).map((h, i) => (
                              <li key={i} className="text-[11px] text-neutral-600 dark:text-neutral-300">
                                <span className="font-semibold">{STATUS_LABELS[h.status]}</span> · {new Date(h.at).toLocaleString()}
                                {h.note ? ` — ${h.note}` : ''}
                              </li>
                            ))}
                          </ol>
                        </div>

                        {canManage && ['payment_pending', 'under_review', 'verified'].includes(a.status) && (
                          <div className="space-y-2">
                            {mine && a.status !== 'verified' && (
                              <p className="text-[11px] text-amber-700">You cannot approve your own application.</p>
                            )}
                            <input
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder={a.status === 'verified' ? 'Reason for revoking (required)' : 'Reason (required to reject; optional note on approve)'}
                              className={`${field} w-full`}
                              maxLength={500}
                            />
                            <div className="flex flex-wrap gap-2">
                              {a.status === 'payment_pending' && (
                                <Btn disabled={busy} onClick={() => run(() => startReview(a, currentUid, auditCtx), 'Marked under review.')}>
                                  Start review
                                </Btn>
                              )}
                              {a.status !== 'verified' && (
                                <>
                                  <Btn
                                    tone="primary"
                                    disabled={busy || mine}
                                    onClick={() =>
                                      onAskConfirm({
                                        title: `Approve @${a.username || a.uid}?`,
                                        description: `Confirm you matched ${PAYMENT_METHOD_LABELS[a.method]} transaction ${a.transactionId} for ${formatMoney(a.amount, a.currency)} in your payment records. The verified badge appears immediately.`,
                                        confirmLabel: 'Approve & verify',
                                        action: () => run(() => approveApplication(a, currentUid, reason, auditCtx), 'Approved. Profile is now verified.'),
                                      })
                                    }
                                  >
                                    Approve
                                  </Btn>
                                  <Btn
                                    tone="danger"
                                    disabled={busy || reason.trim().length < 3}
                                    onClick={() => run(() => rejectApplication(a, currentUid, reason, auditCtx), 'Application rejected.')}
                                  >
                                    Reject
                                  </Btn>
                                </>
                              )}
                              {a.status === 'verified' && (
                                <Btn
                                  tone="danger"
                                  disabled={busy || reason.trim().length < 3}
                                  onClick={() => run(() => revokeVerification(a, currentUid, reason, auditCtx), 'Verification revoked.')}
                                >
                                  Revoke verification
                                </Btn>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <AdminPagination page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
          {searchHits === null && hasMore && page >= Math.ceil(filtered.length / PAGE_SIZE) && (
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-semibold disabled:opacity-60"
            >
              {loadingMore ? 'Loading…' : `Load next ${FETCH_SIZE} from server`}
            </button>
          )}
          {searchHits !== null && (
            <p className="text-[11px] text-neutral-400">Server search results (up to {SEARCH_CAP} per field). Clear the search box to return to the full list.</p>
          )}
        </>
      )}
    </AdminCard>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="text-neutral-500 shrink-0 w-28">{k}</dt>
      <dd className="min-w-0">{v}</dd>
    </div>
  );
}

function Btn({
  children,
  onClick,
  disabled,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'primary' | 'danger';
}) {
  const tones = {
    neutral: 'border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800',
    primary: 'bg-[#1877F2] hover:bg-[#166FE5] text-white',
    danger: 'bg-red-600 hover:bg-red-700 text-white',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-3.5 py-2 text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${tones[tone]}`}
    >
      {children}
    </button>
  );
}

function VerifiedList({
  users,
  appByUid,
  canManage,
  busy,
  onRevoke,
}: {
  users: any[];
  appByUid: Map<string, PaidVerificationApplication>;
  canManage: boolean;
  busy: boolean;
  onRevoke: (u: any, app: PaidVerificationApplication | undefined, reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  if (users.length === 0) return <p className="text-sm text-neutral-500">No verified users.</p>;
  return (
    <ul className="space-y-2">
      {canManage && (
        <li>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Reason for revoking (required — enter before pressing Revoke)"
            className={`${field} w-full`}
            aria-label="Revocation reason"
          />
        </li>
      )}
      {users.map((u) => {
        const app = appByUid.get(u.uid);
        return (
          <li key={u.uid} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">@{u.username} <span className="font-normal text-neutral-500">· {u.displayName}</span></p>
              <p className="text-[11px] text-neutral-500">
                {app ? `Paid · approved ${fmtDate(app.approvedAt)} · ${PAYMENT_METHOD_LABELS[app.method]} ${app.transactionId}` : `Verified via ${u.verificationType || 'document review'}`}
              </p>
            </div>
            {canManage && (
              <Btn tone="danger" disabled={busy || reason.trim().length < 3} onClick={() => onRevoke(u, app, reason)}>Revoke</Btn>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Super Admin: payment configuration ---------------- */

function PaymentSettingsPanel({
  currentUid,
  onWriteAudit,
  onNotifyAction,
}: {
  currentUid: string;
  onWriteAudit: Props['onWriteAudit'];
  onNotifyAction: Props['onNotifyAction'];
}) {
  const [cfg, setCfg] = useState<VerificationConfig | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fee, setFee] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let first = true;
    return subscribeVerificationConfig((c) => {
      // Do not clobber what the admin is typing: hydrate the form once, from the stored config.
      if (first) {
        setCfg(c || normalizeConfig({}));
        setFee(c && c.feeAmount ? String(c.feeAmount) : '');
        setLoaded(true);
        first = false;
      }
    });
  }, []);

  if (!loaded || !cfg) return <p className="text-sm text-neutral-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>;

  const setMethod = (id: PaymentMethodId, patch: Partial<VerificationConfig['methods'][PaymentMethodId]>) =>
    setCfg({ ...cfg, methods: { ...cfg.methods, [id]: { ...cfg.methods[id], ...patch } } });

  const save = async () => {
    const feeNum = Number(fee);
    if (!Number.isFinite(feeNum) || feeNum <= 0) return onNotifyAction('Enter a verification fee greater than 0.');
    for (const id of PAYMENT_METHOD_IDS) {
      if (cfg.methods[id].enabled && !/^\+?[0-9]{10,15}$/.test(cfg.methods[id].number.replace(/[\s-]/g, '')))
        return onNotifyAction(`${PAYMENT_METHOD_LABELS[id]} is enabled but its number is missing or invalid.`);
    }
    if (cfg.enabled && !PAYMENT_METHOD_IDS.some((id) => cfg.methods[id].enabled))
      return onNotifyAction('Enable at least one payment method before enabling verification.');
    setSaving(true);
    try {
      const next = {
        ...cfg,
        feeAmount: feeNum,
        methods: Object.fromEntries(
          PAYMENT_METHOD_IDS.map((id) => [id, { ...cfg.methods[id], number: cfg.methods[id].number.replace(/[\s-]/g, '') }])
        ) as VerificationConfig['methods'],
      };
      await saveVerificationConfig(next, currentUid);
      // Audit summary deliberately omits payment numbers.
      await onWriteAudit(
        'verification_payment_settings_updated',
        'verificationConfig',
        'settings',
        `System ${next.enabled ? 'enabled' : 'disabled'}; fee ${next.feeAmount} ${next.currency}; methods: ${PAYMENT_METHOD_IDS.filter((i) => next.methods[i].enabled).join(', ') || 'none'}`
      );
      onNotifyAction('Payment settings saved.');
    } catch (e: any) {
      onNotifyAction(e?.code === 'permission-denied' ? 'Only a Super Admin can change payment settings.' : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} />
        Paid verification system enabled
      </label>
      <div className="grid grid-cols-2 gap-3 max-w-sm">
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="pv-fee">Verification fee</label>
          <input id="pv-fee" inputMode="decimal" className={`${field} w-full`} value={fee} onChange={(e) => setFee(e.target.value)} />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" htmlFor="pv-cur">Currency</label>
          <input id="pv-cur" className={`${field} w-full uppercase`} maxLength={3} value={cfg.currency} onChange={(e) => setCfg({ ...cfg, currency: e.target.value.toUpperCase() })} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium mb-1" htmlFor="pv-gen">General payment instructions</label>
        <textarea id="pv-gen" rows={3} maxLength={1500} className={`${field} w-full`} value={cfg.generalInstructions} onChange={(e) => setCfg({ ...cfg, generalInstructions: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {PAYMENT_METHOD_IDS.map((id) => (
          <div key={id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={cfg.methods[id].enabled} onChange={(e) => setMethod(id, { enabled: e.target.checked })} />
              {PAYMENT_METHOD_LABELS[id]}
            </label>
            <input aria-label={`${PAYMENT_METHOD_LABELS[id]} number`} inputMode="tel" placeholder="Account number" className={`${field} w-full`} value={cfg.methods[id].number} onChange={(e) => setMethod(id, { number: e.target.value })} />
            <select aria-label={`${PAYMENT_METHOD_LABELS[id]} account type`} className={`${field} w-full`} value={cfg.methods[id].accountType} onChange={(e) => setMethod(id, { accountType: e.target.value as any })}>
              <option value="personal">Personal</option>
              <option value="agent">Agent</option>
              <option value="merchant">Merchant</option>
            </select>
            <textarea aria-label={`${PAYMENT_METHOD_LABELS[id]} instructions`} rows={3} maxLength={1000} placeholder="Instructions shown to the user" className={`${field} w-full`} value={cfg.methods[id].instructions} onChange={(e) => setMethod(id, { instructions: e.target.value })} />
          </div>
        ))}
      </div>
      <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5 inline-flex items-center gap-2">
        {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save settings
      </button>
      <p className="text-[11px] text-neutral-500">
        Fee changes apply to new submissions immediately; the server rejects any payment whose amount differs from the fee saved here.
      </p>
    </div>
  );
}
