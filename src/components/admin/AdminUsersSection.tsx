import React, { useMemo, useState } from 'react';
import { Search, ShieldCheck, X } from 'lucide-react';
import { doc, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { grantVerificationManually, revokeProfileOnly } from '@/src/lib/paidVerification';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import { AdminCard, AdminPagination, AdminStateIndicator } from '@/src/components/admin/AdminShared';
import { isFunctionsFallbackError } from '@/src/lib/monetization';

interface AdminUsersSectionProps {
  users: any[];
  userEmailsByUid: Record<string, string>;
  reports: any[];
  posts: any[];
  reels: any[];
  listings: any[];
  communities: any[];
  marketOrders: any[];
  currentAdminUid: string;
  canManageUsers: boolean;
  /** Super Admin only: manual verification grant/revoke (paid verification is handled in its own module). */
  canGrantVerification?: boolean;
  actorEmail?: string;
  actorRole?: string;
  initialSearch?: string;
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

const PAGE_SIZE = 12;

export function AdminUsersSection({
  users,
  userEmailsByUid,
  reports,
  posts,
  reels,
  listings,
  communities,
  marketOrders,
  currentAdminUid,
  canManageUsers,
  canGrantVerification = false,
  actorEmail,
  actorRole,
  initialSearch = '',
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: AdminUsersSectionProps) {
  const userSiteUrl: string = (import.meta.env.VITE_USER_SITE_URL || '').replace(/\/$/, '');
  const [search, setSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended' | 'banned' | 'msg_restricted'>('all');
  const [flagFilter, setFlagFilter] = useState<'all' | 'verified' | 'creator' | 'reported'>('all');
  const [page, setPage] = useState(1);
  const [inspectUser, setInspectUser] = useState<any | null>(null);
  const [actionReason, setActionReason] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === 'msg_restricted' && !u.messagingRestricted) return false;
      if (statusFilter !== 'all' && statusFilter !== 'msg_restricted' && u.accountStatus !== statusFilter) {
        return false;
      }
      if (flagFilter === 'verified' && !u.isVerified) return false;
      if (flagFilter === 'creator' && !u.isCreator) return false;
      if (flagFilter === 'reported' && !reports.some((r) => r.targetId === u.id)) return false;

      if (!q) return true;
      const email = (userEmailsByUid[u.id] || '').toLowerCase();
      return (
        String(u.displayName || '').toLowerCase().includes(q) ||
        String(u.username || '').toLowerCase().includes(q) ||
        String(u.id || '').toLowerCase().includes(q) ||
        email.includes(q)
      );
    });
  }, [users, userEmailsByUid, reports, search, statusFilter, flagFilter]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const applyUserStatus = async (
    targetUser: any,
    updates: { accountStatus?: 'active' | 'suspended' | 'banned'; messagingRestricted?: boolean; reason?: string }
  ) => {
    try {
      await invokeCloudFunction('adminManageUserStatus', {
        targetUid: targetUser.id,
        ...updates,
      });
    } catch (err: any) {
      if (!isFunctionsFallbackError(err)) throw err;
      // Public profile only gets accountStatus; the note and messaging restriction are private (userPrivate).
      const publicUpdates: Record<string, any> = { updatedAt: serverTimestamp() };
      const privateUpdates: Record<string, any> = { uid: targetUser.id, updatedAt: serverTimestamp() };
      if (updates.accountStatus) {
        publicUpdates.accountStatus = updates.accountStatus;
        privateUpdates.accountRestrictionNote =
          updates.accountStatus === 'active'
            ? ''
            : updates.reason || `Account set to ${updates.accountStatus} by administration.`;
      }
      if (typeof updates.messagingRestricted === 'boolean') {
        privateUpdates.messagingRestricted = updates.messagingRestricted;
      }
      const sb = writeBatch(db);
      if (updates.accountStatus) sb.update(doc(db, 'users', targetUser.id), publicUpdates);
      sb.set(doc(db, 'userPrivate', targetUser.id), privateUpdates, { merge: true });
      await sb.commit();
      await onWriteAudit(
        'admin_manage_user_status',
        'user',
        targetUser.id,
        `Updated @${targetUser.username} (${updates.accountStatus ? `status=${updates.accountStatus}` : `msgRestricted=${updates.messagingRestricted}`})`
      );
    }
    onNotifyAction(`Updated standing for @${targetUser.username}.`);
  };

  return (
    <div className="space-y-4">
      <AdminCard className="p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg">
              User Accounts Directory ({filtered.length} / {users.length})
            </h2>
            <p className="text-xs text-neutral-500">
              Search by name, @username, email address, or UID. Private messages and calls remain strictly isolated.
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
                placeholder="Name, @handle, email, or UID..."
                className="h-9 w-56 pl-8 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-xs"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setPage(1);
              }}
              className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="banned">Deactivated / Banned</option>
              <option value="msg_restricted">Messaging Restricted</option>
            </select>
            <select
              value={flagFilter}
              onChange={(e) => {
                setFlagFilter(e.target.value as any);
                setPage(1);
              }}
              className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
            >
              <option value="all">All Accounts</option>
              <option value="verified">Verified Only</option>
              <option value="creator">Creators Only</option>
              <option value="reported">With Reports</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
              <tr>
                <th className="py-2.5 pr-3 font-medium">Account</th>
                <th className="py-2.5 pr-3 font-medium">Email / UID</th>
                <th className="py-2.5 pr-3 font-medium">Followers</th>
                <th className="py-2.5 pr-3 font-medium">Standing</th>
                <th className="py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {paged.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-neutral-500">
                    No user accounts match your filters.
                  </td>
                </tr>
              ) : (
                paged.map((u) => {
                  const email = userEmailsByUid[u.id] || '';
                  const reportHits = reports.filter((rep) => rep.targetId === u.id).length;
                  const isSelf = u.id === currentAdminUid;

                  return (
                    <tr key={u.id} className="hover:bg-neutral-50/70 dark:hover:bg-neutral-800/30">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                            {u.displayName}
                          </span>
                          {u.isVerified && <ShieldCheck className="w-3.5 h-3.5 text-[#1877F2]" />}
                          {u.isCreator && (
                            <span className="text-[10px] font-mono font-semibold text-indigo-600 dark:text-indigo-400">
                              · Creator
                            </span>
                          )}
                        </div>
                        <p className="text-neutral-500">
                          @{u.username}
                          {reportHits > 0 && (
                            <span className="text-rose-600 dark:text-rose-400 font-mono">
                              {' '}
                              · {reportHits} report{reportHits > 1 ? 's' : ''}
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-[11px] text-neutral-500">
                        <p className="truncate max-w-[190px]">{email || 'Email private / N/A'}</p>
                        <p className="text-[10px] text-neutral-400 truncate max-w-[190px]">{u.id}</p>
                      </td>
                      <td className="py-2.5 pr-3 font-mono tabular-nums">{u.followersCount || 0}</td>
                      <td className="py-2.5 pr-3">
                        <div className="space-y-0.5">
                          <AdminStateIndicator status={u.accountStatus || 'active'} />
                          {u.messagingRestricted && (
                            <p className="text-[10px] font-mono text-amber-600">Msg Restricted</p>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setActionReason('');
                              setInspectUser(u);
                            }}
                            className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            Inspect
                          </button>
                          {canManageUsers && !isSelf && (
                            <>
                              {canGrantVerification && (
<button
                                type="button"
                                onClick={() =>
                                  onAskConfirm({
                                    title: u.isVerified ? 'Remove Verification Badge' : 'Verify User Account',
                                    description: `${u.isVerified ? 'Remove verification from' : 'Grant verified badge to'} @${u.username}?`,
                                    confirmLabel: u.isVerified ? 'Unverify' : 'Verify Account',
                                    variant: u.isVerified ? 'danger' : 'primary',
                                    action: async () => {
                                      // Atomic users update + audit record. Firestore Rules allow this for Super Admin only.
                                      const ctxInfo = { actorEmail, actorRole };
                                      if (u.isVerified) {
                                        await revokeProfileOnly(u.id, u.username, currentAdminUid, 'Manual revocation by Super Admin', ctxInfo);
                                      } else {
                                        await grantVerificationManually(u.id, u.username, 'identity', currentAdminUid, 'Manual verification by Super Admin', ctxInfo);
                                      }
                                      onNotifyAction(`Updated verification badge for @${u.username}.`);
                                    },
                                  })
                                }
                                className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
                              >
                                {u.isVerified ? 'Unverify' : 'Verify'}
                              </button>
)}
                              <button
                                type="button"
                                onClick={() => {
                                  const next = u.accountStatus === 'active' ? 'suspended' : 'active';
                                  onAskConfirm({
                                    title: next === 'suspended' ? 'Suspend Account' : 'Restore Account',
                                    description: `Set @${u.username} standing to "${next}"?`,
                                    confirmLabel: next === 'suspended' ? 'Suspend' : 'Restore Active',
                                    variant: next === 'suspended' ? 'danger' : 'primary',
                                    action: () => applyUserStatus(u, { accountStatus: next }),
                                  });
                                }}
                                className={`px-2.5 py-1 rounded-lg border ${
                                  u.accountStatus === 'active'
                                    ? 'border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400'
                                    : 'border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400'
                                }`}
                              >
                                {u.accountStatus === 'active' ? 'Suspend' : 'Restore'}
                              </button>
                              {u.accountStatus !== 'banned' && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onAskConfirm({
                                      title: 'Deactivate / Ban Account',
                                      description: `Permanently deactivate @${u.username}? They will be blocked from posting, messaging, and marketplace actions.`,
                                      confirmLabel: 'Deactivate Account',
                                      variant: 'danger',
                                      action: () => applyUserStatus(u, { accountStatus: 'banned' }),
                                    })
                                  }
                                  className="px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-900 text-red-600"
                                >
                                  Deactivate
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <AdminPagination page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
      </AdminCard>

      {/* Safe Account & Non-Private Activity Inspect Modal */}
      {inspectUser && (() => {
        const email = userEmailsByUid[inspectUser.id] || 'Hidden / unavailable';
        const userReports = reports.filter((rep) => rep.targetId === inspectUser.id);
        const userPostsCount = posts.filter((p) => p.authorId === inspectUser.id).length;
        const userReelsCount = reels.filter((r) => r.authorId === inspectUser.id).length;
        const userListingsCount = listings.filter((l) => l.sellerId === inspectUser.id).length;
        const userCommunitiesCount = communities.filter((c) => c.creatorId === inspectUser.id).length;
        const userOrdersCount = marketOrders.filter(
          (o) => o.buyerId === inspectUser.id || o.sellerId === inspectUser.id
        ).length;

        return (
          <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
            <div className="w-full max-w-lg rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4 text-xs max-h-[88vh] overflow-y-auto">
              <div className="flex items-start justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
                <div>
                  <h3 className="font-display font-bold text-base flex items-center gap-1.5">
                    {inspectUser.displayName}
                    {inspectUser.isVerified && <ShieldCheck className="w-4 h-4 text-[#1877F2]" />}
                  </h3>
                  <p className="text-neutral-500 font-mono text-[11px]">
                    @{inspectUser.username} · {inspectUser.id}
                  </p>
                  <p className="text-neutral-500 font-mono text-[11px]">{email}</p>
                </div>
                <button type="button" onClick={() => setInspectUser(null)} aria-label="Close user inspector">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {userReports.length >= 1 && (
                <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-medium">
                  Account Safety History: {userReports.length} report(s) filed against this account.
                </div>
              )}

              {/* Non-private safe activity summary */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
                {[
                  { k: 'Followers', v: inspectUser.followersCount || 0 },
                  { k: 'Posts', v: userPostsCount },
                  { k: 'Reels', v: userReelsCount },
                  { k: 'Listings', v: userListingsCount },
                  { k: 'Groups', v: userCommunitiesCount },
                  { k: 'Orders', v: userOrdersCount },
                ].map((stat) => (
                  <div key={stat.k} className="p-2 rounded-lg bg-neutral-100 dark:bg-neutral-900">
                    <p className="text-[10px] text-neutral-500">{stat.k}</p>
                    <p className="font-mono font-bold text-sm tabular-nums">{stat.v}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5 pt-1">
                <p>
                  <strong>Account Status:</strong> <AdminStateIndicator status={inspectUser.accountStatus || 'active'} />
                </p>
                <p>
                  <strong>Messaging Restricted:</strong> {inspectUser.messagingRestricted ? 'Yes (Blocked)' : 'No'}
                </p>
                <p>
                  <strong>Creator Status:</strong> {inspectUser.isCreator ? 'Approved Creator' : 'Standard User'}
                </p>
                <p>
                  <strong>Privacy Profile:</strong> {inspectUser.isPrivateAccount ? 'Private Account' : 'Public'} · Who Can Message:{' '}
                  {inspectUser.whoCanMessage || 'everyone'}
                </p>
                {inspectUser.accountRestrictionNote && (
                  <p className="text-amber-700 dark:text-amber-300">
                    <strong>Restriction Note:</strong> {inspectUser.accountRestrictionNote}
                  </p>
                )}
              </div>

              {canManageUsers && inspectUser.id !== currentAdminUid && (
                <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2.5">
                  <p className="font-semibold">Moderation Action</p>
                  <input
                    type="text"
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                    placeholder="Optional audit reason / user notification note..."
                    className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: inspectUser.messagingRestricted ? 'Restore Messaging' : 'Restrict Messaging',
                          description: `Update messaging access for @${inspectUser.username}?`,
                          confirmLabel: inspectUser.messagingRestricted ? 'Restore Messaging' : 'Restrict Messaging',
                          variant: inspectUser.messagingRestricted ? 'primary' : 'danger',
                          action: async () => {
                            await applyUserStatus(inspectUser, {
                              messagingRestricted: !inspectUser.messagingRestricted,
                              reason: actionReason,
                            });
                            setInspectUser(null);
                          },
                        })
                      }
                      className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 font-semibold"
                    >
                      {inspectUser.messagingRestricted ? 'Restore Messaging' : 'Restrict Messaging'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: inspectUser.accountStatus === 'active' ? 'Suspend Account' : 'Restore Active Account',
                          description: `Apply standing change to @${inspectUser.username}?`,
                          confirmLabel: 'Confirm',
                          variant: inspectUser.accountStatus === 'active' ? 'danger' : 'primary',
                          action: async () => {
                            await applyUserStatus(inspectUser, {
                              accountStatus: inspectUser.accountStatus === 'active' ? 'suspended' : 'active',
                              reason: actionReason,
                            });
                            setInspectUser(null);
                          },
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-semibold"
                    >
                      {inspectUser.accountStatus === 'active' ? 'Suspend Account' : 'Restore Account'}
                    </button>
                    {inspectUser.accountStatus !== 'banned' && (
                      <button
                        type="button"
                        onClick={() =>
                          onAskConfirm({
                            title: 'Deactivate / Ban Account',
                            description: `Permanently deactivate @${inspectUser.username}?`,
                            confirmLabel: 'Deactivate',
                            variant: 'danger',
                            action: async () => {
                              await applyUserStatus(inspectUser, {
                                accountStatus: 'banned',
                                reason: actionReason,
                              });
                              setInspectUser(null);
                            },
                          })
                        }
                        className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold"
                      >
                        Deactivate / Ban
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
                {userSiteUrl && (
                  <a
                    href={`${userSiteUrl}/profile/${encodeURIComponent(inspectUser.username)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 font-semibold"
                  >
                    Open Profile
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setInspectUser(null)}
                  className="px-4 py-2 rounded-xl bg-[#1877F2] text-white font-semibold"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
