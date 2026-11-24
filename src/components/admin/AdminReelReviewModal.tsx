import React, { useEffect, useState } from 'react';
import { Film, Flag, Loader2, X } from 'lucide-react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/src/firebase';
import type { BanaReel } from '@/src/types/bana';
import { AdminStateIndicator } from '@/src/components/admin/AdminShared';
import { formatCompactNumber, formatRelativeTime } from '@/src/lib/mediaUtils';
import { formatDurationClock } from '@/src/lib/videoUtils';

interface AdminReelReviewModalProps {
  reelId: string;
  canModerate: boolean;
  onClose: () => void;
  /** Called with the intended action; the parent runs it through the real backend (adminModerateContent). */
  onModerate?: (reel: BanaReel, action: 'remove' | 'restore') => void;
  onInspectCreator?: (usernameOrId: string) => void;
}

interface ReelReport {
  id: string;
  reason: string;
  details?: string;
  status: string;
  createdAt?: any;
}

/**
 * Admin review of a single Reel: real playback, stored metadata, creator and report history.
 * All data is read from Firestore; nothing is mocked. Moderation actions are delegated to the parent
 * so they use the same authorized backend path as the rest of the Admin Panel.
 */
export function AdminReelReviewModal({
  reelId,
  canModerate,
  onClose,
  onModerate,
  onInspectCreator,
}: AdminReelReviewModalProps) {
  const [reel, setReel] = useState<BanaReel | null>(null);
  const [reports, setReports] = useState<ReelReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVideoFailed(false);
    setUseBackup(false);
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'reels', reelId));
        if (cancelled) return;
        if (!snap.exists()) {
          setError('This Reel no longer exists.');
          setReel(null);
        } else {
          setReel({ id: snap.id, ...(snap.data() as Omit<BanaReel, 'id'>) });
        }
        const repSnap = await getDocs(
          query(collection(db, 'reports'), where('targetId', '==', reelId), limit(50))
        ).catch(() => null);
        if (!cancelled && repSnap) {
          setReports(
            repSnap.docs
              .map((d) => ({ id: d.id, ...(d.data() as any) }))
              .filter((r: any) => r.targetType === 'reel' || r.targetType === 'video')
          );
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Could not load this Reel.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reelId]);

  const src = reel ? (useBackup && reel.backupVideoUrl ? reel.backupVideoUrl : reel.videoUrl) : '';
  const sizeMb = reel?.fileSizeBytes ? `${(Number(reel.fileSizeBytes) / (1024 * 1024)).toFixed(1)} MB` : '—';

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-3"
      role="dialog"
      aria-modal="true"
      aria-label="Reel review"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur">
          <h3 className="font-bold text-sm inline-flex items-center gap-2">
            <Film className="w-4 h-4 text-[#1877F2]" /> Reel Review
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
          </div>
        ) : error || !reel ? (
          <p className="py-12 text-center text-sm text-rose-600">{error || 'Reel unavailable.'}</p>
        ) : (
          <div className="p-4 grid md:grid-cols-[240px_1fr] gap-4 text-xs">
            <div className="space-y-2">
              <div className="aspect-[9/16] w-full rounded-xl overflow-hidden bg-black relative">
                {videoFailed ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center text-white/80">
                    <p>Video could not be played.</p>
                    {reel.backupVideoUrl && !useBackup && (
                      <button
                        type="button"
                        onClick={() => {
                          setVideoFailed(false);
                          setUseBackup(true);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-white text-black font-semibold"
                      >
                        Try backup copy
                      </button>
                    )}
                  </div>
                ) : (
                  <video
                    key={src}
                    src={src}
                    poster={reel.thumbnailUrl || undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full h-full object-contain"
                    onError={() => setVideoFailed(true)}
                  />
                )}
              </div>
              <p className="text-[10px] text-neutral-500 leading-snug">
                Preview plays the stored file directly. No transcoding is applied.
              </p>
            </div>

            <div className="space-y-4 min-w-0">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminStateIndicator status={reel.status || 'active'} />
                  <span className="font-mono text-[10px] uppercase text-neutral-500">
                    {reel.visibility} · {reel.processingStatus || 'ready'}
                  </span>
                </div>
                {reel.title && <p className="font-semibold text-sm">{reel.title}</p>}
                <p className="text-neutral-700 dark:text-neutral-300 break-words">{reel.caption || '—'}</p>
                {reel.hashtags && reel.hashtags.length > 0 && (
                  <p className="text-[#1877F2]">{reel.hashtags.map((h) => `#${h}`).join(' ')}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Creator', `@${reel.authorUsername}`],
                  ['Created', formatRelativeTime(reel.createdAt)],
                  ['Views', formatCompactNumber(reel.viewsCount || 0)],
                  ['Likes', formatCompactNumber(reel.likesCount || 0)],
                  ['Comments', formatCompactNumber(reel.commentsCount || 0)],
                  ['Duration', reel.durationSeconds ? formatDurationClock(reel.durationSeconds) : '—'],
                  ['File size', sizeMb],
                  ['Format', reel.mimeType || '—'],
                  ['Storage', reel.storageProvider || '—'],
                  ['Backup', reel.backupProvider || 'none'],
                ].map(([k, v]) => (
                  <div
                    key={k}
                    className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5"
                  >
                    <p className="text-[10px] text-neutral-500">{k}</p>
                    <p className="font-medium truncate">{v}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <p className="font-semibold inline-flex items-center gap-1.5">
                  <Flag className="w-3.5 h-3.5 text-rose-500" /> Reports ({reports.length})
                </p>
                {reports.length === 0 ? (
                  <p className="text-neutral-500">No reports for this Reel.</p>
                ) : (
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {reports.map((r) => (
                      <li
                        key={r.id}
                        className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{r.reason}</span>
                          <AdminStateIndicator status={r.status || 'pending'} />
                        </div>
                        {r.details && <p className="text-neutral-500 mt-0.5 break-words">{r.details}</p>}
                        <p className="text-[10px] text-neutral-400 mt-0.5">{formatRelativeTime(r.createdAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {onInspectCreator && (
                  <button
                    type="button"
                    onClick={() => onInspectCreator(reel.authorUsername || reel.authorId)}
                    className="h-9 px-3 rounded-lg border border-neutral-200 dark:border-neutral-700 font-medium"
                  >
                    Inspect creator
                  </button>
                )}
                {canModerate && onModerate && (
                  <button
                    type="button"
                    onClick={() => onModerate(reel, reel.status === 'removed' ? 'restore' : 'remove')}
                    className={`h-9 px-3 rounded-lg font-semibold text-white ${
                      reel.status === 'removed' ? 'bg-emerald-600' : 'bg-rose-600'
                    }`}
                  >
                    {reel.status === 'removed' ? 'Restore Reel' : 'Remove Reel'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
