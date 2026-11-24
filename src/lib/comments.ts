import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { writeBackupAudit } from '@/src/lib/storage/backupEngine';
import type { BanaComment } from '@/src/types/bana';

const activeCommentMutations = new Set<string>();

export interface CreateCommentParams {
  targetType: 'post' | 'reel';
  targetId: string;
  authorId: string;
  authorUsername: string;
  authorName: string;
  authorAvatar?: string;
  content: string;
  parentCommentId?: string;
  replyToUsername?: string;
}

export async function createHardenedComment(params: CreateCommentParams): Promise<string> {
  const cleanContent = params.content.trim();
  if (!cleanContent) {
    throw new Error('Comment cannot be empty.');
  }

  const clientMutationId = `${params.authorId}_${params.targetId}_${cleanContent.slice(0, 24)}_${Math.floor(Date.now() / 3000)}`;
  if (activeCommentMutations.has(clientMutationId)) {
    throw new Error('Duplicate submission ignored.');
  }

  activeCommentMutations.add(clientMutationId);
  try {
    const docRef = await addDoc(collection(db, 'comments'), {
      targetType: params.targetType,
      targetId: params.targetId,
      authorId: params.authorId,
      authorUsername: params.authorUsername,
      authorName: params.authorName,
      authorAvatar: params.authorAvatar || '',
      content: cleanContent.slice(0, 1500),
      likesCount: 0,
      reactionSummary: {},
      moderationStatus: 'active',
      deletionStatus: 'active',
      clientMutationId,
      ...(params.parentCommentId ? { parentCommentId: params.parentCommentId } : {}),
      ...(params.replyToUsername ? { replyToUsername: params.replyToUsername } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return docRef.id;
  } finally {
    window.setTimeout(() => activeCommentMutations.delete(clientMutationId), 2000);
  }
}

export async function softDeleteComment(
  comment: Pick<BanaComment, 'id'>,
  actorUid: string,
  hasReplies = false
): Promise<void> {
  if (!hasReplies) {
    // Still mark soft_deleted first for audit trail recoverability under Phase 13 policy
    await updateDoc(doc(db, 'comments', comment.id), {
      deletionStatus: 'soft_deleted',
      deletedBy: actorUid,
      deletedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  await updateDoc(doc(db, 'comments', comment.id), {
    deletionStatus: 'soft_deleted',
    deletedBy: actorUid,
    deletedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function restoreSoftDeletedComment(
  commentId: string,
  adminUid: string,
  adminEmail: string
): Promise<void> {
  await updateDoc(doc(db, 'comments', commentId), {
    deletionStatus: 'active',
    moderationStatus: 'active',
    deletedBy: null,
    deletedAt: null,
    updatedAt: serverTimestamp(),
  });
  await writeBackupAudit(
    adminUid,
    adminEmail,
    'comment_restored',
    'comments',
    commentId,
    `Restored soft-deleted comment ${commentId} back to active feed.`
  );
}

export async function purgeCommentPermanently(
  commentId: string,
  adminUid: string,
  adminEmail: string
): Promise<void> {
  await deleteDoc(doc(db, 'comments', commentId));
  await writeBackupAudit(
    adminUid,
    adminEmail,
    'comment_purged',
    'comments',
    commentId,
    `Permanently deleted comment ${commentId} from Firestore.`
  );
}

export function formatVisibleCommentText(comment: BanaComment): string {
  if (comment.deletionStatus === 'soft_deleted') {
    return '[Comment deleted]';
  }
  if (comment.moderationStatus === 'removed' || comment.moderationStatus === 'hidden') {
    return '[Hidden by moderation]';
  }
  return comment.content;
}
