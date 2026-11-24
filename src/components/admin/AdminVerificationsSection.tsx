import React, { useMemo, useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { grantVerificationManually } from '@/src/lib/paidVerification';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import { isFunctionsFallbackError } from '@/src/lib/monetization';
import { AdminCard, AdminPagination, AdminStateIndicator } from '@/src/components/admin/AdminShared';
import { formatRelativeTime } from '@/src/lib/mediaUtils';

interface AdminVerificationsSectionProps {
  currentUid: string;
  verificationRequests: any[];
  canManageVerifications: boolean;
  /** Super Admin only: granting verified status is no longer available to moderators / support staff. */
  canGrantVerification: boolean;
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

export function AdminVerificationsSection({
  currentUid,
  verificationRequests,
  canManageVerifications,
  canGrantVerification,
  actorEmail,
  actorRole,
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: AdminVerificationsSectionProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'needs_info' | 'approved' | 'rejected'>('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return verificationRequests.filter((vr) => {
      if (statusFilter !== 'all' && vr.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(vr.fullName || '').toLowerCase().includes(q) ||
        String(vr.username || '').toLowerCase().includes(q) ||
        String(vr.uid || '').toLowerCase().includes(q) ||
        String(vr.category || '').toLowerCase().includes(q)
      );
    });
  }, [verificationRequests, statusFilter, search]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const handleReview = async (vr: any, decision: 'approved' | 'rejected' | 'needs_info') => {
    const note = (noteById[vr.id] || '').trim();
    if (decision === 'approved' && !canGrantVerification) {
      onNotifyAction('Only a Super Admin can grant verified status. Paid verification is approved from the Paid Verification module.');
      return;
    }
    try {
      await invokeCloudFunction('reviewVerificationRequest', {
        requestId: vr.id,
        decision,
        adminNote: note,
      });
    } catch (err: any) {
      // Only fall back when Cloud Functions are unavailable (Spark). Authorization or validation
      // errors from the backend must surface instead of being silently retried client-side.
      if (!isFunctionsFallbackError(err)) {
        onNotifyAction(err?.message || 'Verification review failed.');
        return;
      }
      const nextHistory = [
        ...(Array.isArray(vr.history) ? vr.history : []),
        { status: decision, note, actorUid: currentUid, at: new Date().toISOString() },
      ];
      await updateDoc(doc(db, 'verificationRequests', vr.id), {
        status: decision,
        adminNote: note,
        reviewedBy: currentUid,
        history: nextHistory,
        updatedAt: serverTimestamp(),
      });
      if (decision === 'approved') {
        // Atomic users update + audit record; Firestore Rules deny this for every role except Super Admin.
        await grantVerificationManually(
          vr.uid,
          vr.username || '',
          vr.type === 'organization' ? 'organization' : 'identity',
          currentUid,
          note || 'Identity/organization document review approved.',
          { actorEmail, actorRole }
        );
      }
      await onWriteAudit(
        `verification_${decision}`,
        'verificationRequest',
        vr.id,
        `Verification ${decision} for @${vr.username || vr.uid}`
      );
      await addDoc(collection(db, 'notifications'), {
        recipientId: vr.uid,
        actorId: currentUid,
        actorName: 'BANA Verification',
        actorAvatar: '',
        type: 'verification',
        title:
          decision === 'approved'
            ? 'Account Verified'
            : decision === 'needs_info'
            ? 'More Info Needed for Verification'
            : 'Verification Request Update',
        body:
          decision === 'approved'
            ? 'Your BANA account is now verified.'
            : note || `Verification status changed to ${decision}.`,
        linkUrl: `/profile/${vr.username || vr.uid}`,
        isRead: false,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
    onNotifyAction(`Verification request for ${vr.fullName || vr.username} marked ${decision}.`);
  };

  return (
    <AdminCard className="p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#1877F2]" />
            Profile Verification Requests ({filtered.length} / {verificationRequests.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Review identity and organization verification submissions with private document verification.
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
              placeholder="Search name, @handle, UID..."
              className="h-9 pl-8 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-xs"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
            className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
          >
            <option value="pending">Pending</option>
            <option value="needs_info">Needs Info</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All Requests</option>
          </select>
        </div>
      </div>

      {paged.length === 0 ? (
        <p className="text-xs text-neutral-500 py-8 text-center">No verification requests match these filters.</p>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {paged.map((vr) => (
            <div key={vr.id} className="py-4 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-sm">{vr.fullName}</span>
                    <span className="text-neutral-500">(@{vr.username || vr.uid})</span>
                    <AdminStateIndicator status={vr.status || 'pending'} />
                  </div>
                  <p className="text-[11px] text-neutral-500 mt-0.5 capitalize font-mono">
                    Type: {vr.type || 'identity'} · Category: {vr.category || 'General'} · Submitted{' '}
                    {formatRelativeTime(vr.createdAt)}
                  </p>
                </div>
                {vr.documentUrl && (
                  <a
                    href={vr.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[#1877F2] font-semibold"
                  >
                    Inspect Proof ({vr.documentName || 'File'})
                  </a>
                )}
              </div>

              {vr.reason && <p className="text-neutral-700 dark:text-neutral-300">{vr.reason}</p>}

              {Array.isArray(vr.publicLinks) && vr.publicLinks.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {vr.publicLinks.map((lnk: string, i: number) => (
                    <a
                      key={i}
                      href={lnk}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-[#1877F2] hover:underline font-mono"
                    >
                      {lnk}
                    </a>
                  ))}
                </div>
              )}

              {vr.userResponseNote && (
                <p className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-[11px] text-blue-800 dark:text-blue-200">
                  <strong>Applicant Reply:</strong> {vr.userResponseNote}
                </p>
              )}

              {canManageVerifications && (
                <div className="flex flex-col sm:flex-row gap-2 pt-1">
                  <input
                    type="text"
                    value={noteById[vr.id] ?? vr.adminNote ?? ''}
                    onChange={(e) => setNoteById((prev) => ({ ...prev, [vr.id]: e.target.value }))}
                    placeholder="Reviewer note or feedback for applicant..."
                    className="flex-1 h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-xs"
                  />
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {canGrantVerification && (
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: 'Approve Account Verification',
                          description: `Grant official verified status to @${vr.username || vr.uid}?`,
                          confirmLabel: 'Approve Verification',
                          variant: 'primary',
                          action: () => handleReview(vr, 'approved'),
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                    >
                      Approve
                    </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleReview(vr, 'needs_info')}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                    >
                      Request Info
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: 'Reject Verification Request',
                          description: `Reject verification request for @${vr.username || vr.uid}?`,
                          confirmLabel: 'Reject Request',
                          variant: 'danger',
                          action: () => handleReview(vr, 'rejected'),
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <AdminPagination page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </AdminCard>
  );
}
