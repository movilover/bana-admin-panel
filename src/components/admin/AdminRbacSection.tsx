import React, { useEffect, useState } from 'react';
import { Check, ShieldCheck, X } from 'lucide-react';
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { BOOTSTRAPPED_ADMIN_EMAIL, db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import { isFunctionsFallbackError } from '@/src/lib/monetization';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import {
  ADMIN_ROLE_DEFINITIONS,
  PRIMARY_ADMIN_ROLES,
  canPerformAdminAction,
  getAdminRoleLabel,
} from '@/src/lib/adminRbac';
import { AdminCard } from '@/src/components/admin/AdminShared';
import type { AdminRoleType } from '@/src/types/bana';

interface AdminRbacSectionProps {
  currentUid: string;
  adminRole: AdminRoleType;
  claimsAdminRole: AdminRoleType | null;
  users: any[];
  userEmailsByUid: Record<string, string>;
  adminRolesList: any[];
  auditLogs?: any[];
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

const MATRIX_CAPABILITIES: Array<{ label: string; check: (r: AdminRoleType) => boolean }> = [
  { label: 'View Platform Overview & Real-Time Metrics', check: () => true },
  { label: 'User Standing (Suspend / Restrict / Deactivate)', check: (r) => canPerformAdminAction(r, 'manage_users') },
  { label: 'Moderate Posts, Reels, Stories, Comments & Groups', check: (r) => canPerformAdminAction(r, 'moderate_content') },
  { label: 'Review Profile Verification Requests', check: (r) => canPerformAdminAction(r, 'manage_verifications') },
  { label: 'Transfer Community Ownership (Disputes)', check: (r) => canPerformAdminAction(r, 'transfer_community_owner') },
  { label: 'Approve / Reject Creator Monetization Apps', check: (r) => canPerformAdminAction(r, 'manage_monetization_apps') },
  { label: 'Manage Advertisers, Ad Campaigns & Creatives', check: (r) => canPerformAdminAction(r, 'manage_ads') },
  { label: 'Execute Payouts, Refunds & Ledger Adjustments', check: (r) => canPerformAdminAction(r, 'manage_finance') },
  { label: 'Modify Platform Identity, Toggles & Maintenance', check: (r) => canPerformAdminAction(r, 'manage_platform_settings') },
  { label: 'Assign or Revoke Admin Roles & Custom Claims', check: (r) => canPerformAdminAction(r, 'assign_admin_roles') },
];

export function AdminRbacSection({
  currentUid,
  adminRole,
  claimsAdminRole,
  users,
  userEmailsByUid,
  adminRolesList,
  auditLogs = [],
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: AdminRbacSectionProps) {
  const [roleUid, setRoleUid] = useState('');
  const [roleEmail, setRoleEmail] = useState('');
  const [roleType, setRoleType] = useState<AdminRoleType>('moderator');
  const canAssignRoles = canPerformAdminAction(adminRole, 'assign_admin_roles');

  const staffActivity = React.useMemo(() => {
    const roleByUid = new Map<string, string>();
    adminRolesList.forEach((r) => roleByUid.set(String(r.uid || r.id), String(r.role || '')));
    const rows = new Map<
      string,
      { uid: string; label: string; role: string; total: number; failed: number; lastAction: string; lastAt: any }
    >();
    const ensure = (uid: string, label: string) => {
      if (!rows.has(uid)) {
        rows.set(uid, { uid, label, role: roleByUid.get(uid) || '', total: 0, failed: 0, lastAction: '—', lastAt: null });
      }
      return rows.get(uid)!;
    };
    adminRolesList.forEach((r) => ensure(String(r.uid || r.id), String(r.email || r.uid || r.id)));
    auditLogs.forEach((log) => {
      const uid = String(log.actorUid || '');
      if (!uid) return;
      const row = ensure(uid, String(log.actorEmail || uid));
      row.total += 1;
      if (log.result === 'failure' || log.result === 'denied') row.failed += 1;
      const t = typeof log.createdAt?.toMillis === 'function' ? log.createdAt.toMillis() : 0;
      const prev = typeof row.lastAt?.toMillis === 'function' ? row.lastAt.toMillis() : 0;
      if (!row.lastAt || t >= prev) {
        row.lastAt = log.createdAt;
        row.lastAction = String(log.action || '—');
      }
    });
    return Array.from(rows.values()).sort((a, b) => b.total - a.total);
  }, [adminRolesList, auditLogs]);

  const handleAssign = (e: React.FormEvent) => {
    e.preventDefault();
    const targetUid = roleUid.trim();
    if (!targetUid || !canAssignRoles) return;
    onAskConfirm({
      title: 'Confirm Admin Role Assignment',
      description: `Grant "${getAdminRoleLabel(roleType)}" privileges to UID ${targetUid}${roleEmail ? ` (${roleEmail})` : ''}? This updates Firestore RBAC and Firebase Auth Custom Claims.`,
      confirmLabel: 'Assign Role',
      variant: 'danger',
      action: async () => {
        let syncedViaFn = false;
        try {
          await invokeCloudFunction('assignAdminRole', {
            targetUid,
            email: roleEmail.trim(),
            role: roleType,
          });
          syncedViaFn = true;
        } catch (err: any) {
          // A genuine backend rejection (permission / invalid role) must NOT be bypassed by a client write.
          if (!isFunctionsFallbackError(err)) throw err;
          await setDoc(doc(db, 'adminRoles', targetUid), {
            uid: targetUid,
            email: roleEmail.trim(),
            role: roleType,
            assignedBy: currentUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await onWriteAudit('assign_admin_role', 'adminRole', targetUid, `Assigned ${roleType} to ${roleEmail || targetUid}`);
        }
        setRoleUid('');
        setRoleEmail('');
        onNotifyAction(
          syncedViaFn
            ? `Assigned ${getAdminRoleLabel(roleType)} & synced Firebase Auth custom claims.`
            : `Assigned ${getAdminRoleLabel(roleType)} in Firestore RBAC.`
        );
      },
    });
  };

  return (
    <div className="space-y-4">
      <AdminCard className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display font-bold text-lg">Admin Roles, Permissions & Custom Claims</h2>
            <p className="text-xs text-neutral-500">
              Enforced across UI modules, Firestore security rules, and Cloud Functions. Only Super Admins can modify admin assignments.
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-[#1877F2]">
            <ShieldCheck className="w-4 h-4" />
            {claimsAdminRole ? `Custom Claim: ${claimsAdminRole}` : `Session Role: ${adminRole}`}
          </span>
        </div>

        {canAssignRoles ? (
          <form onSubmit={handleAssign} className="space-y-3 p-4 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
              <select
                value=""
                onChange={(e) => {
                  const chosen = users.find((u) => u.id === e.target.value);
                  if (chosen) {
                    setRoleUid(chosen.id);
                    setRoleEmail(userEmailsByUid[chosen.id] || '');
                  }
                }}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                <option value="">Quick-pick existing user...</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName} (@{u.username})
                  </option>
                ))}
              </select>
              <input
                type="text"
                required
                value={roleUid}
                onChange={(e) => setRoleUid(e.target.value)}
                placeholder="Target User UID"
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs font-mono"
              />
              <input
                type="email"
                value={roleEmail}
                onChange={(e) => setRoleEmail(e.target.value)}
                placeholder="Email address"
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <select
                value={roleType}
                onChange={(e) => setRoleType(e.target.value as AdminRoleType)}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                {PRIMARY_ADMIN_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ADMIN_ROLE_DEFINITIONS[r].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <p className="text-neutral-500">{ADMIN_ROLE_DEFINITIONS[roleType]?.summary}</p>
              <button
                type="submit"
                className="px-4 h-9 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white font-semibold shrink-0"
              >
                Assign Admin Role
              </button>
            </div>
          </form>
        ) : (
          <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300">
            Role assignment & revocation is restricted exclusively to Super Admin accounts.
          </div>
        )}

        <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
          {adminRolesList.length === 0 ? (
            <p className="py-4 text-neutral-500">
              No delegated admin entries in `adminRoles` yet (Bootstrapped Super Admin: {BOOTSTRAPPED_ADMIN_EMAIL}).
            </p>
          ) : (
            adminRolesList.map((r) => {
              const isBootstrapped = String(r.email || '').toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL;
              return (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="font-semibold">
                      {getAdminRoleLabel(r.role)} · <span className="font-mono text-neutral-500">{r.email || 'No email recorded'}</span>
                    </p>
                    <p className="font-mono text-[11px] text-neutral-400">UID: {r.uid || r.id}</p>
                  </div>
                  {canAssignRoles && !isBootstrapped && r.id !== currentUid && (
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: 'Revoke Admin Role',
                          description: `Revoke ${getAdminRoleLabel(r.role)} privileges for ${r.email || r.uid}?`,
                          confirmLabel: 'Revoke Role',
                          variant: 'danger',
                          action: async () => {
                            try {
                              await invokeCloudFunction('assignAdminRole', {
                                targetUid: r.uid || r.id,
                                role: 'revoke',
                              });
                            } catch (err: any) {
                              if (!isFunctionsFallbackError(err)) throw err;
                              await deleteDoc(doc(db, 'adminRoles', r.id));
                              await onWriteAudit('revoke_admin_role', 'adminRole', r.id, `Revoked ${r.role}`);
                            }
                            onNotifyAction('Admin role revoked.');
                          },
                        })
                      }
                      className="px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-900 text-red-600 font-semibold"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </AdminCard>

      {/* Prompt 09: Staff Directory & Activity Review (derived only from real audit records) */}
      <AdminCard className="p-5 space-y-3">
        <div>
          <h3 className="font-display font-bold text-sm">Staff Activity Review</h3>
          <p className="text-[11px] text-neutral-500">
            Counts are computed from the {auditLogs.length} most recent append-only audit entries loaded in this session — not estimated.
          </p>
        </div>
        {staffActivity.length === 0 ? (
          <p className="text-xs text-neutral-500 py-3">No staff activity has been recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px] text-left">
              <thead className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Staff</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium text-right">Actions</th>
                  <th className="py-2 pr-3 font-medium text-right">Failed / Denied</th>
                  <th className="py-2 pr-3 font-medium">Last action</th>
                  <th className="py-2 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {staffActivity.map((row) => (
                  <tr key={row.uid}>
                    <td className="py-2 pr-3 font-mono">{row.label}</td>
                    <td className="py-2 pr-3">{row.role ? getAdminRoleLabel(row.role as AdminRoleType) : 'Bootstrapped / unlisted'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.total}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums ${row.failed > 0 ? 'text-rose-600 font-semibold' : ''}`}>{row.failed}</td>
                    <td className="py-2 pr-3 font-mono">{row.lastAction}</td>
                    <td className="py-2 text-neutral-500">{formatRelativeTime(row.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminCard>

      {/* Role Permissions Matrix */}
      <AdminCard className="p-5 space-y-3">
        <h3 className="font-display font-bold text-sm">RBAC Permissions Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] text-left">
            <thead className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
              <tr>
                <th className="py-2 pr-3 font-medium">Capability / Domain</th>
                {PRIMARY_ADMIN_ROLES.map((r) => (
                  <th key={r} className="py-2 px-2 text-center font-semibold whitespace-nowrap">
                    {ADMIN_ROLE_DEFINITIONS[r].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {MATRIX_CAPABILITIES.map((cap) => (
                <tr key={cap.label}>
                  <td className="py-2 pr-3 text-neutral-700 dark:text-neutral-300 font-medium">{cap.label}</td>
                  {PRIMARY_ADMIN_ROLES.map((r) => {
                    const allowed = cap.check(r);
                    return (
                      <td key={r} className="py-2 px-2 text-center">
                        {allowed ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 inline-block" />
                        ) : (
                          <X className="w-3.5 h-3.5 text-neutral-300 dark:text-neutral-700 inline-block" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminCard>

      {adminRole === 'super_admin' && (
        <BootstrapPanel currentUid={currentUid} adminRolesList={adminRolesList} onWriteAudit={onWriteAudit} onNotifyAction={onNotifyAction} onAskConfirm={onAskConfirm} />
      )}
    </div>
  );
}

/**
 * Super Admin bootstrap lifecycle (replaces reliance on the hardcoded e-mail):
 *  1) create your own durable Super Admin record (adminRoles/<uid>),
 *  2) only then disable the bootstrap e-mail (rules refuse step 2 without step 1),
 *  3) re-enable it at any time (or via the Firebase console, see docs/SUPER_ADMIN_RECOVERY.md).
 */
function BootstrapPanel({ currentUid, adminRolesList, onWriteAudit, onNotifyAction, onAskConfirm }: Pick<AdminRbacSectionProps, 'currentUid' | 'adminRolesList' | 'onWriteAudit' | 'onNotifyAction' | 'onAskConfirm'>) {
  const [disabled, setDisabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const myRecord = adminRolesList.find((r) => (r.uid || r.id) === currentUid && r.role === 'super_admin');
  useEffect(() => {
    getDoc(doc(db, 'adminBootstrap', 'state')).then((s) => setDisabled(s.exists() ? s.data().disabled === true : false)).catch(() => setDisabled(null));
  }, []);
  const setBootstrap = async (value: boolean) => {
    setBusy(true);
    try {
      await setDoc(doc(db, 'adminBootstrap', 'state'), { disabled: value, updatedAt: serverTimestamp() });
      await onWriteAudit(value ? 'bootstrap_super_admin_disabled' : 'bootstrap_super_admin_enabled', 'adminBootstrap', 'state', `Bootstrap e-mail access ${value ? 'disabled' : 'enabled'}`);
      setDisabled(value);
      onNotifyAction(`Bootstrap e-mail access ${value ? 'disabled' : 're-enabled'}.`);
    } catch (e: any) {
      onNotifyAction(e?.code === 'permission-denied' ? 'Denied: create your own Super Admin record first.' : 'Could not change bootstrap state.');
    } finally { setBusy(false); }
  };
  const createMyRecord = async () => {
    setBusy(true);
    try {
      await setDoc(doc(db, 'adminRoles', currentUid), { uid: currentUid, email: BOOTSTRAPPED_ADMIN_EMAIL, role: 'super_admin', assignedBy: currentUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      await onWriteAudit('super_admin_record_created', 'adminRoles', currentUid, 'Durable Super Admin record created for the signed-in Super Admin');
      onNotifyAction('Your durable Super Admin record was created.');
    } catch { onNotifyAction('Could not create the record.'); } finally { setBusy(false); }
  };
  return (
    <AdminCard className="p-5 space-y-3">
      <h3 className="font-display font-semibold text-sm">Super Admin bootstrap</h3>
      <p className="text-xs text-neutral-500">The built-in bootstrap e-mail works until you retire it. Retire it only after your own Super Admin record exists. Recovery steps are in docs/SUPER_ADMIN_RECOVERY.md.</p>
      <ul className="text-xs space-y-1">
        <li>Your durable Super Admin record: <b>{myRecord ? 'present' : 'missing'}</b></li>
        <li>Bootstrap e-mail access: <b>{disabled === null ? 'unknown' : disabled ? 'disabled' : 'active'}</b></li>
      </ul>
      <div className="flex flex-wrap gap-2">
        {!myRecord && <button type="button" disabled={busy} onClick={() => void createMyRecord()} className="px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-semibold disabled:opacity-50">Create my Super Admin record</button>}
        {disabled === false && (
          <button type="button" disabled={busy || !myRecord} onClick={() => onAskConfirm({
            title: 'Disable bootstrap e-mail access?', description: 'The hardcoded e-mail will stop being a Super Admin. Your own Super Admin record keeps full access. You can re-enable it here or from the Firebase console.',
            confirmLabel: 'Disable', variant: 'danger', action: () => setBootstrap(true),
          })} className="px-3 py-1.5 rounded-lg border border-red-300 text-red-700 text-xs font-semibold disabled:opacity-40">Disable bootstrap access</button>
        )}
        {disabled === true && <button type="button" disabled={busy} onClick={() => void setBootstrap(false)} className="px-3 py-1.5 rounded-lg border border-neutral-300 text-xs font-semibold">Re-enable bootstrap access</button>}
      </div>
    </AdminCard>
  );
}
