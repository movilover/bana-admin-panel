import React, { useMemo, useState } from 'react';
import { Check, Search, Trash2, X } from 'lucide-react';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import { reconcileDistributionAfterReport, resolveVideoTarget, setVideoDistributionStatus } from '@/src/lib/videoModeration';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import { AdminCard, AdminPagination, AdminStateIndicator } from '@/src/components/admin/AdminShared';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import { isFunctionsFallbackError } from '@/src/lib/monetization';
import { AdminReelReviewModal } from '@/src/components/admin/AdminReelReviewModal';

interface UnifiedReport {
  id: string;
  sourceCollection: 'reports' | 'marketplaceReports';
  targetType: string;
  targetId: string;
  reason: string;
  details: string;
  reporterId?: string;
  status: string;
  resolutionNote?: string;
  createdAt?: any;
}

interface AdminReportsSectionProps {
  reports: any[];
  marketReports: any[];
  canModerateContent: boolean;
  currentUid?: string;
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

const TARGET_COL_MAP: Record<string, string> = {
  post: 'posts',
  reel: 'reels',
  video: 'reels',
  story: 'stories',
  comment: 'comments',
  voice_comment: 'voiceComments',
  product: 'marketplaceListings',
  listing: 'marketplaceListings',
  community: 'communities',
  group: 'communities',
};

const PAGE_SIZE = 12;

export function AdminReportsSection({
  reports,
  marketReports,
  canModerateContent,
  currentUid = '',
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: AdminReportsSectionProps) {
  const [catFilter, setCatFilter] = useState<string>('all');
  const [reviewReelId, setReviewReelId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'resolved' | 'dismissed' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const unified = useMemo<UnifiedReport[]>(() => {
    const a: UnifiedReport[] = reports.map((r) => ({
      id: r.id,
      sourceCollection: 'reports',
      targetType: String(r.targetType || 'post'),
      targetId: String(r.targetId || ''),
      reason: String(r.reason || 'Policy Report'),
      details: String(r.details || ''),
      reporterId: r.reporterId,
      status: String(r.status || 'pending'),
      resolutionNote: r.resolutionNote,
      createdAt: r.createdAt,
    }));
    const b: UnifiedReport[] = marketReports.map((r) => ({
      id: r.id,
      sourceCollection: 'marketplaceReports',
      targetType: String(r.targetType || 'product'),
      targetId: String(r.targetId || ''),
      reason: String(r.reason || 'Marketplace Report'),
      details: String(r.details || ''),
      reporterId: r.reporterId,
      status: String(r.status || 'pending'),
      resolutionNote: r.resolutionNote,
      createdAt: r.createdAt,
    }));
    return [...a, ...b];
  }, [reports, marketReports]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return unified.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (catFilter !== 'all') {
        if (catFilter === 'reel_video' && !['reel', 'video'].includes(r.targetType)) return false;
        if (catFilter === 'comment' && !['comment', 'voice_comment'].includes(r.targetType)) return false;
        if (catFilter === 'community' && !['community', 'event', 'community_member', 'group'].includes(r.targetType))
          return false;
        if (catFilter === 'marketplace' && !['product', 'store', 'review', 'listing'].includes(r.targetType))
          return false;
        if (catFilter === 'ad' && !['ad', 'adCampaign', 'campaign'].includes(r.targetType)) return false;
        if (catFilter === 'user' && r.targetType !== 'user') return false;
        if (catFilter === 'post' && r.targetType !== 'post') return false;
        if (catFilter === 'message' && !['message', 'conversation'].includes(r.targetType)) return false;
      }
      if (!q) return true;
      return (
        r.reason.toLowerCase().includes(q) ||
        r.details.toLowerCase().includes(q) ||
        r.targetId.toLowerCase().includes(q) ||
        r.targetType.toLowerCase().includes(q)
      );
    });
  }, [unified, statusFilter, catFilter, search]);

  const paged = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const updateReportStatus = async (rep: UnifiedReport, status: 'resolved' | 'dismissed', note = '') => {
    await updateDoc(doc(db, rep.sourceCollection, rep.id), {
      status,
      resolutionNote: note,
      updatedAt: serverTimestamp(),
    });
    await onWriteAudit(
      `${status}_report`,
      rep.sourceCollection,
      rep.id,
      `Marked ${rep.targetType} report ${status}`
    );
    // Reconcile smart video distribution with the moderation decision (only for video targets; never from report counts).
    let distributionNote = '';
    if (rep.sourceCollection === 'reports' && currentUid) {
      distributionNote = await reconcileDistributionAfterReport(rep, status === 'dismissed' ? 'dismissed' : 'resolved', currentUid).catch(() => '');
    }
    onNotifyAction(`Report marked ${status}.${distributionNote ? ' ' + distributionNote : ''}`);
  };

  // A moderator can hold a reported video for review (distribution stays at stage 1 / not expanded) without removing it.
  const holdForReview = async (rep: UnifiedReport) => {
    const target = await resolveVideoTarget(rep.targetType, rep.targetId);
    if (!target || !currentUid) { onNotifyAction('This report target is not a video.'); return; }
    await setVideoDistributionStatus(target, 'under_review', `Held for review: report ${rep.id}`, currentUid, 'report_hold');
    await onWriteAudit('hold_video_for_review', 'videoStats', rep.targetId, `Held ${rep.targetType} ${rep.targetId} for review (report ${rep.id})`);
    onNotifyAction('Video held for review. It will not expand until a moderator releases it.');
  };

  const removeTargetAndResolve = async (rep: UnifiedReport) => {
    const colName = TARGET_COL_MAP[rep.targetType];
    if (!colName || !rep.targetId) {
      await updateReportStatus(rep, 'resolved', 'Resolved by moderation');
      return;
    }
    try {
      await invokeCloudFunction('adminModerateContent', {
        collectionName: colName,
        docId: rep.targetId,
        action: 'remove',
        reportId: rep.id,
        reportCollection: rep.sourceCollection,
        reason: `Removed following report: ${rep.reason}`,
      });
    } catch (err: any) {
      if (!isFunctionsFallbackError(err)) throw err;
      await updateDoc(doc(db, colName, rep.targetId), {
        status: colName === 'communities' ? 'suspended' : 'removed',
        updatedAt: serverTimestamp(),
      }).catch(() => {});
      await updateDoc(doc(db, rep.sourceCollection, rep.id), {
        status: 'resolved',
        resolutionNote: `Removed ${colName}/${rep.targetId}`,
        updatedAt: serverTimestamp(),
      });
      await onWriteAudit(
        `moderate_remove_${colName}`,
        colName,
        rep.targetId,
        `Removed target & resolved report ${rep.id}`
      );
    }
    let removalNote = '';
    if (rep.sourceCollection === 'reports' && currentUid) {
      removalNote = await reconcileDistributionAfterReport(rep, 'removed', currentUid).catch(() => '');
    }
    onNotifyAction(`Target removed & report resolved.${removalNote ? ' ' + removalNote : ''}`);
  };

  return (
    <>
    <AdminCard className="p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display font-bold text-lg">
            Unified Reports & Moderation Center ({filtered.length} / {unified.length})
          </h2>
          <p className="text-xs text-neutral-500">
            Central triage across User, Post, Reel, Comment, Community, Marketplace, Ad, and Message metadata reports.
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
              placeholder="Search reason or target ID..."
              className="h-9 pl-8 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-xs"
            />
          </div>
          <select
            value={catFilter}
            onChange={(e) => {
              setCatFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
          >
            <option value="all">All Categories</option>
            <option value="user">User Reports</option>
            <option value="post">Post Reports</option>
            <option value="reel_video">Reel / Video Reports</option>
            <option value="comment">Comment Reports</option>
            <option value="community">Group / Event Reports</option>
            <option value="marketplace">Marketplace Reports</option>
            <option value="ad">Ad Reports</option>
            <option value="message">Message Metadata Reports</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as any);
              setPage(1);
            }}
            className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
          >
            <option value="pending">Pending</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
            <option value="all">All Statuses</option>
          </select>
        </div>
      </div>

      {paged.length === 0 ? (
        <p className="text-xs text-neutral-500 py-10 text-center">No reports match the selected filters.</p>
      ) : (
        <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
          {paged.map((rep) => {
            const hasContentTarget = Boolean(TARGET_COL_MAP[rep.targetType]);
            return (
              <div
                key={`${rep.sourceCollection}_${rep.id}`}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] uppercase font-bold text-[#1877F2]">
                      {rep.targetType}
                    </span>
                    <span className="text-neutral-400">·</span>
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100">{rep.reason}</span>
                    <span className="text-neutral-400">·</span>
                    <AdminStateIndicator status={rep.status} />
                  </div>
                  <p className="text-neutral-600 dark:text-neutral-400">{rep.details || 'No extra details provided.'}</p>
                  <p className="font-mono text-[11px] text-neutral-400">
                    Target: {rep.targetId} · {formatRelativeTime(rep.createdAt)}
                  </p>
                </div>

                {rep.status === 'pending' && (
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    {canModerateContent && rep.sourceCollection === 'reports' && ['reel', 'video', 'post'].includes(rep.targetType) && (
                      <button
                        type="button"
                        onClick={() => void holdForReview(rep)}
                        className="px-2.5 py-1.5 rounded-lg border border-amber-400 text-amber-700 dark:text-amber-400 font-semibold"
                      >
                        Hold video
                      </button>
                    )}
                    {['reel', 'video'].includes(rep.targetType) && (
                      <button
                        type="button"
                        onClick={() => setReviewReelId(rep.targetId)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#1877F2] text-white font-semibold"
                      >
                        Review
                      </button>
                    )}
                    {canModerateContent && hasContentTarget && (
                      <button
                        type="button"
                        onClick={() =>
                          onAskConfirm({
                            title: 'Remove Reported Content & Resolve',
                            description: `Remove ${rep.targetType} (${rep.targetId}) from public feeds and mark this report resolved?`,
                            confirmLabel: 'Remove Target',
                            variant: 'danger',
                            action: () => removeTargetAndResolve(rep),
                          })
                        }
                        className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-semibold inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Remove Target
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => updateReportStatus(rep, 'resolved')}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold inline-flex items-center gap-1"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Resolve
                    </button>
                    <button
                      type="button"
                      onClick={() => updateReportStatus(rep, 'dismissed')}
                      className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 font-semibold inline-flex items-center gap-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <AdminPagination page={page} totalItems={filtered.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
    </AdminCard>
    {reviewReelId && (
      <AdminReelReviewModal
        reelId={reviewReelId}
        canModerate={false}
        onClose={() => setReviewReelId(null)}
      />
    )}
    </>
  );
}
