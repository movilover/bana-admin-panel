import React, { useMemo, useState } from 'react';
import { Bell, Download, History, Search } from 'lucide-react';
import { addDoc, collection, doc, getDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { AdminCard, AdminPagination, exportRowsToCsv } from '@/src/components/admin/AdminShared';
import { formatRelativeTime } from '@/src/lib/mediaUtils';

interface AdminNotificationsSectionProps {
  currentUid: string;
  canDispatch?: boolean;
  users: any[];
  onWriteAudit: (
    action: string,
    targetType: string,
    targetId: string,
    summary: string,
    result?: 'success' | 'failure' | 'denied'
  ) => Promise<void>;
  onNotifyAction: (msg: string) => void;
}

export function AdminNotificationsSection({
  currentUid,
  canDispatch = false,
  users,
  onWriteAudit,
  onNotifyAction,
}: AdminNotificationsSectionProps) {
  const [targetUid, setTargetUid] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [noticeType, setNoticeType] = useState<'verification' | 'community' | 'marketplace' | 'monetization' | 'ad'>('verification');
  const [sending, setSending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!canDispatch) {
    return (
      <AdminCard className="p-5 text-sm text-neutral-500">
        Your staff role is not permitted to send official user notifications.
      </AdminCard>
    );
  }

  return (
    <AdminCard className="p-5">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setFormError(null);
          const recipient = targetUid.trim();
          if (!recipient || !title.trim() || !body.trim() || sending) return;
          if (title.trim().length > 120 || body.trim().length > 500) {
            setFormError('Title max 120 characters, message max 500 characters.');
            return;
          }
          setSending(true);
          try {
            const exists = await getDoc(doc(db, 'users', recipient));
            if (!exists.exists()) {
              setFormError('No user with this UID exists.');
              return;
            }
            const ref = await addDoc(collection(db, 'notifications'), {
              recipientId: recipient,
              actorId: currentUid,
              actorName: 'BANA Administration',
              actorAvatar: '',
              type: noticeType,
              title: title.trim(),
              body: body.trim(),
              linkUrl: '/notifications',
              isRead: false,
              createdAt: serverTimestamp(),
            });
            await onWriteAudit('dispatch_notification', 'notifications', ref.id, `Sent "${title.trim()}" to ${recipient}`);
            setTitle('');
            setBody('');
            onNotifyAction('Official notification dispatched.');
          } catch (err: any) {
            await onWriteAudit('dispatch_notification', 'notifications', recipient, 'Notification dispatch failed', 'failure');
            setFormError(err?.message || 'Could not send the notification.');
          } finally {
            setSending(false);
          }
        }}
        className="space-y-3 text-xs"
      >
        <h2 className="font-display font-bold text-lg flex items-center gap-2">
          <Bell className="w-5 h-5 text-[#1877F2]" />
          Send Official Admin Notification
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <select
            value=""
            onChange={(e) => setTargetUid(e.target.value)}
            className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
          >
            <option value="">Quick-pick recipient...</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} (@{u.username})
              </option>
            ))}
          </select>
          <input
            type="text"
            required
            value={targetUid}
            onChange={(e) => setTargetUid(e.target.value)}
            placeholder="Recipient User UID"
            className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
          />
        </div>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Notification Title"
          className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-sm"
        />
        <textarea
          rows={3}
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message body..."
          className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3 text-sm"
        />
        <select
          value={noticeType}
          onChange={(e) => setNoticeType(e.target.value as typeof noticeType)}
          className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
        >
          <option value="verification">Category: Verification / account</option>
          <option value="community">Category: Community</option>
          <option value="marketplace">Category: Marketplace</option>
          <option value="monetization">Category: Monetization</option>
          <option value="ad">Category: Advertising</option>
        </select>
        {formError && <p className="text-rose-600 font-medium">{formError}</p>}
        <button
          type="submit"
          disabled={sending}
          className="px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-60 text-white font-semibold"
        >
          {sending ? 'Sending…' : 'Send Notification'}
        </button>
      </form>
    </AdminCard>
  );
}

const LOG_PAGE_SIZE = 18;

export function AdminAuditLogsSection({ auditLogs }: { auditLogs: any[] }) {
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [resultFilter, setResultFilter] = useState('all');
  const [page, setPage] = useState(1);

  const actionTypes = useMemo(
    () => Array.from(new Set(auditLogs.map((l) => String(l.action || '')))).filter(Boolean).sort(),
    [auditLogs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return auditLogs.filter((l) => {
      if (actionFilter !== 'all' && l.action !== actionFilter) return false;
      if (resultFilter !== 'all' && (l.result || 'success') !== resultFilter) return false;
      if (!q) return true;
      return (
        String(l.action || '').toLowerCase().includes(q) ||
        String(l.summary || '').toLowerCase().includes(q) ||
        String(l.actorEmail || l.actorUid || '').toLowerCase().includes(q) ||
        String(l.targetId || '').toLowerCase().includes(q)
      );
    });
  }, [auditLogs, search, actionFilter, resultFilter]);

  const paged = useMemo(() => {
    const start = (page - 1) * LOG_PAGE_SIZE;
    return filtered.slice(start, start + LOG_PAGE_SIZE);
  }, [filtered, page]);

  return (
    <AdminCard className="p-5 space-y-4 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display font-bold text-lg flex items-center gap-2">
            <History className="w-5 h-5 text-[#1877F2]" />
            Immutable Admin Activity & Security Logs ({filtered.length} / {auditLogs.length})
          </h2>
          <p className="text-neutral-500">
            Append-only audit trail recording administrative logins, RBAC changes, financial settlements, and moderation decisions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search actor, summary, target..."
              className="h-9 pl-8 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5"
          >
            <option value="all">All Actions</option>
            {actionTypes.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select
            value={resultFilter}
            onChange={(e) => {
              setResultFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5"
          >
            <option value="all">All Results</option>
            <option value="success">Success</option>
            <option value="failure">Failure</option>
            <option value="denied">Denied</option>
          </select>
          <button
            type="button"
            onClick={() =>
              exportRowsToCsv(
                `bana-audit-logs-${new Date().toISOString().slice(0, 10)}.csv`,
                ['Action', 'Result', 'Target Type', 'Target ID', 'Actor', 'Actor Role', 'Summary'],
                filtered.map((l) => [
                  l.action,
                  l.result || 'success',
                  l.targetType,
                  l.targetId,
                  l.actorEmail || l.actorUid,
                  l.actorRole || '',
                  l.summary,
                ])
              )
            }
            className="h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-semibold inline-flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </button>
        </div>
      </div>

      {paged.length === 0 ? (
        <p className="text-neutral-500 py-8 text-center">No audit events match your filters.</p>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {paged.map((log) => (
            <div key={log.id} className="py-2.5 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono font-semibold text-neutral-900 dark:text-neutral-100">
                  {log.action}
                  {(log.result === 'failure' || log.result === 'denied') && (
                    <span className="ml-2 px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 text-[10px] uppercase">
                      {log.result}
                    </span>
                  )}
                </p>
                <p className="text-neutral-500">
                  {log.summary} · {log.targetType}:{log.targetId} · By {log.actorEmail || log.actorUid}
                  {log.actorRole ? ` (${log.actorRole})` : ''}
                </p>
              </div>
              <span className="font-mono text-[11px] text-neutral-400 shrink-0 tabular-nums">
                {formatRelativeTime(log.createdAt)}
              </span>
            </div>
          ))}
        </div>
      )}

      <AdminPagination page={page} totalItems={filtered.length} pageSize={LOG_PAGE_SIZE} onPageChange={setPage} />
    </AdminCard>
  );
}
