import { collection, doc, getDocs, getDoc, limit, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { contentKeyFor } from '@/src/lib/videoDistribution';

export type DistStatus = 'auto' | 'paused' | 'stopped' | 'under_review' | 'restricted';

export interface VideoTarget { type: 'reel' | 'post'; id: string }

/** Resolve a report target to a video (reel, or a post whose type is 'video'). Returns null when it is not a video. */
export async function resolveVideoTarget(targetType: string, targetId: string): Promise<(VideoTarget & { authorId: string; createdAt: any }) | null> {
  if (!targetId) return null;
  if (targetType === 'reel' || targetType === 'video') {
    const s = await getDoc(doc(db, 'reels', targetId)).catch(() => null);
    return s?.exists() ? { type: 'reel', id: targetId, authorId: String(s.data().authorId || ''), createdAt: s.data().createdAt } : null;
  }
  if (targetType === 'post') {
    const s = await getDoc(doc(db, 'posts', targetId)).catch(() => null);
    return s?.exists() && s.data().type === 'video'
      ? { type: 'post', id: targetId, authorId: String(s.data().authorId || ''), createdAt: s.data().createdAt }
      : null;
  }
  return null;
}

/**
 * Change a video's distribution status. The private stats doc (reason + actor), the public ranking doc (status only) and the
 * append-only distribution log are written in ONE batch; Firestore Rules tie the three together (vdPublicModOk).
 */
export async function setVideoDistributionStatus(
  t: VideoTarget & { authorId: string; createdAt: any },
  status: DistStatus,
  reason: string,
  actorUid: string,
  action = 'status_change'
): Promise<void> {
  const key = contentKeyFor(t.type, t.id);
  const meta = { ownerId: t.authorId, contentType: t.type, contentId: t.id, contentCreatedAt: t.createdAt };
  const b = writeBatch(db);
  b.set(doc(db, 'videoStats', key), {
    ...meta, distStatus: status, distReason: reason.trim().slice(0, 300), distUpdatedBy: actorUid, distUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  }, { merge: true });
  b.set(doc(db, 'videoStatsPublic', key), { ...meta, distStatus: status, updatedAt: serverTimestamp() }, { merge: true });
  b.set(doc(collection(db, 'videoDistributionLog')), {
    key, action, status, reason: reason.trim().slice(0, 300), actorId: actorUid, createdAt: serverTimestamp(),
  });
  await b.commit();
}

/**
 * Keep distribution consistent with a moderation decision on a report (never automatic from report counts):
 *  - 'removed'   → content removed by a moderator → distribution stopped.
 *  - 'dismissed' → report unfounded → if the video was held 'under_review' and NO other pending report remains, release it to 'auto'.
 *  - 'resolved'  → handled by a moderator → status is left exactly as the moderator set it (history kept in the log).
 * Returns a short human note describing what happened, or '' when the target is not a video.
 */
export async function reconcileDistributionAfterReport(
  rep: { id: string; targetType: string; targetId: string },
  decision: 'removed' | 'dismissed' | 'resolved',
  actorUid: string
): Promise<string> {
  const target = await resolveVideoTarget(rep.targetType, rep.targetId);
  if (!target) return '';
  const key = contentKeyFor(target.type, target.id);
  if (decision === 'removed') {
    await setVideoDistributionStatus(target, 'stopped', `Content removed after report ${rep.id}`, actorUid, 'report_removed');
    return 'Distribution stopped.';
  }
  if (decision === 'dismissed') {
    const cur = await getDoc(doc(db, 'videoStats', key)).catch(() => null);
    if (cur?.exists() && cur.data().distStatus === 'under_review') {
      const others = await getDocs(query(collection(db, 'reports'), where('targetId', '==', rep.targetId), where('status', '==', 'pending'), limit(3))).catch(() => null);
      const stillPending = (others?.docs || []).some((d) => d.id !== rep.id);
      if (!stillPending) {
        await setVideoDistributionStatus(target, 'auto', `Report ${rep.id} dismissed`, actorUid, 'report_dismissed_release');
        return 'Hold released: distribution is back to automatic.';
      }
      return 'Other reports are still pending, so the review hold stays.';
    }
  }
  return '';
}
