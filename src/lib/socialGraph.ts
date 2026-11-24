import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  limit,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '@/src/firebase';
import type {
  BanaUser,
  BanaNotification,
  FollowRequestRecord,
  FriendRequestRecord,
  FriendshipRecord,
} from '@/src/types/bana';

export type FriendStatus = 'none' | 'sent_pending' | 'received_pending' | 'friends';
export type FollowRequestStatus = 'none' | 'sent_pending' | 'received_pending';

export interface SocialRelationship {
  isFollowing: boolean;
  followsMe: boolean;
  followRequestStatus: FollowRequestStatus;
  friendStatus: FriendStatus;
  isBlockedByMe: boolean;
  amIBlocked: boolean;
  isRestrictedByMe: boolean;
  amIRestricted: boolean;
}

export interface SuggestedUserItem {
  user: BanaUser;
  score: number;
  mutualFriendsCount: number;
  sharedInterests: string[];
  reason: string;
}

export function getFriendshipPairId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

export async function createSocialNotification(params: {
  recipientId: string;
  actor: { uid: string; displayName: string; avatarUrl?: string; username?: string };
  type: BanaNotification['type'];
  title: string;
  body: string;
  linkUrl: string;
  dedupeKey: string;
}): Promise<void> {
  if (!params.recipientId || params.recipientId === params.actor.uid) return;
  await addDoc(collection(db, 'notifications'), {
    recipientId: params.recipientId,
    actorId: params.actor.uid,
    actorName: params.actor.displayName || 'Someone',
    actorAvatar: params.actor.avatarUrl || '',
    type: params.type,
    title: params.title,
    body: params.body,
    linkUrl: params.linkUrl,
    dedupeKey: params.dedupeKey,
    isRead: false,
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

export async function checkPairBlocked(uidA: string, uidB: string): Promise<{ blockedByMe: boolean; amIBlocked: boolean }> {
  if (!uidA || !uidB || uidA === uidB) return { blockedByMe: false, amIBlocked: false };
  const [byMe, byOther] = await Promise.all([
    getDoc(doc(db, 'userBlocks', `${uidA}_${uidB}`)).catch(() => null),
    getDoc(doc(db, 'userBlocks', `${uidB}_${uidA}`)).catch(() => null),
  ]);
  return {
    blockedByMe: Boolean(byMe?.exists()),
    amIBlocked: Boolean(byOther?.exists()),
  };
}

export async function getSocialRelationship(myUid: string, targetUid: string): Promise<SocialRelationship> {
  if (!myUid || !targetUid || myUid === targetUid) {
    return {
      isFollowing: false,
      followsMe: false,
      followRequestStatus: 'none',
      friendStatus: 'none',
      isBlockedByMe: false,
      amIBlocked: false,
      isRestrictedByMe: false,
      amIRestricted: false,
    };
  }

  const pairId = getFriendshipPairId(myUid, targetUid);
  const [
    followingSnap,
    followsMeSnap,
    sentFollowReqSnap,
    recFollowReqSnap,
    sentFriendReqSnap,
    recFriendReqSnap,
    friendshipSnap,
    blockByMeSnap,
    blockByOtherSnap,
    restrictByMeSnap,
    restrictByOtherSnap,
  ] = await Promise.all([
    getDoc(doc(db, 'userFollows', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'userFollows', `${targetUid}_${myUid}`)).catch(() => null),
    getDoc(doc(db, 'followRequests', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'followRequests', `${targetUid}_${myUid}`)).catch(() => null),
    getDoc(doc(db, 'friendRequests', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'friendRequests', `${targetUid}_${myUid}`)).catch(() => null),
    getDoc(doc(db, 'friendships', pairId)).catch(() => null),
    getDoc(doc(db, 'userBlocks', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'userBlocks', `${targetUid}_${myUid}`)).catch(() => null),
    getDoc(doc(db, 'userRestrictions', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'userRestrictions', `${targetUid}_${myUid}`)).catch(() => null),
  ]);

  let followRequestStatus: FollowRequestStatus = 'none';
  if (!followingSnap?.exists()) {
    if (sentFollowReqSnap?.exists() && sentFollowReqSnap.data()?.status === 'pending') {
      followRequestStatus = 'sent_pending';
    } else if (recFollowReqSnap?.exists() && recFollowReqSnap.data()?.status === 'pending') {
      followRequestStatus = 'received_pending';
    }
  }

  let friendStatus: FriendStatus = 'none';
  if (friendshipSnap?.exists()) {
    friendStatus = 'friends';
  } else if (
    (sentFriendReqSnap?.exists() && sentFriendReqSnap.data()?.status === 'accepted') ||
    (recFriendReqSnap?.exists() && recFriendReqSnap.data()?.status === 'accepted')
  ) {
    friendStatus = 'friends';
  } else if (sentFriendReqSnap?.exists() && sentFriendReqSnap.data()?.status === 'pending') {
    friendStatus = 'sent_pending';
  } else if (recFriendReqSnap?.exists() && recFriendReqSnap.data()?.status === 'pending') {
    friendStatus = 'received_pending';
  }

  return {
    isFollowing: Boolean(followingSnap?.exists()),
    followsMe: Boolean(followsMeSnap?.exists()),
    followRequestStatus,
    friendStatus,
    isBlockedByMe: Boolean(blockByMeSnap?.exists()),
    amIBlocked: Boolean(blockByOtherSnap?.exists()),
    isRestrictedByMe: Boolean(restrictByMeSnap?.exists()),
    amIRestricted: Boolean(restrictByOtherSnap?.exists()),
  };
}

export async function followOrRequestUser(
  me: BanaUser,
  targetUser: BanaUser
): Promise<'following' | 'requested'> {
  if (me.uid === targetUser.uid) throw new Error('You cannot follow your own account.');
  const { blockedByMe, amIBlocked } = await checkPairBlocked(me.uid, targetUser.uid);
  if (blockedByMe || amIBlocked) {
    throw new Error('Cannot follow this account due to block settings.');
  }

  const requiresApproval = Boolean(targetUser.isPrivateAccount || targetUser.whoCanFollow === 'approval');
  if (requiresApproval) {
    const reqId = `${me.uid}_${targetUser.uid}`;
    const existingReq = await getDoc(doc(db, 'followRequests', reqId)).catch(() => null);
    if (existingReq?.exists()) {
      if (existingReq.data()?.status === 'pending') return 'requested';
      await deleteDoc(doc(db, 'followRequests', reqId));
    }
    await setDoc(doc(db, 'followRequests', reqId), {
      fromUid: me.uid,
      toUid: targetUser.uid,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await createSocialNotification({
      recipientId: targetUser.uid,
      actor: me,
      type: 'follow_request',
      title: 'Follow Request',
      body: `${me.displayName} requested to follow you.`,
      linkUrl: `/profile/${me.username || me.uid}`,
      dedupeKey: `follow_req_${me.uid}_${targetUser.uid}`,
    });
    return 'requested';
  }

  const followId = `${me.uid}_${targetUser.uid}`;
  const alreadyFollowing = await getDoc(doc(db, 'userFollows', followId)).catch(() => null);
  if (alreadyFollowing?.exists()) return 'following';
  await setDoc(doc(db, 'userFollows', followId), {
    followerId: me.uid,
    followingId: targetUser.uid,
    createdAt: serverTimestamp(),
  });
  await createSocialNotification({
    recipientId: targetUser.uid,
    actor: me,
    type: 'follow',
    title: 'New Follower',
    body: `${me.displayName} started following you on BANA.`,
    linkUrl: `/profile/${me.username || me.uid}`,
    dedupeKey: `follow_${me.uid}_${targetUser.uid}`,
  });
  return 'following';
}

export async function cancelFollowRequest(myUid: string, targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'followRequests', `${myUid}_${targetUid}`));
}

export async function unfollowUser(myUid: string, targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'userFollows', `${myUid}_${targetUid}`));
}

export async function removeFollower(myUid: string, followerUid: string): Promise<void> {
  await deleteDoc(doc(db, 'userFollows', `${followerUid}_${myUid}`));
}

export async function acceptFollowRequest(me: BanaUser, requesterUid: string): Promise<void> {
  // ATOMIC: request status + the follow edge commit together or not at all.
  const batch = writeBatch(db);
  batch.update(doc(db, 'followRequests', `${requesterUid}_${me.uid}`), { status: 'accepted', updatedAt: serverTimestamp() });
  batch.set(doc(db, 'userFollows', `${requesterUid}_${me.uid}`), {
    followerId: requesterUid,
    followingId: me.uid,
    createdAt: serverTimestamp(),
  });
  await batch.commit();

  await createSocialNotification({
    recipientId: requesterUid,
    actor: me,
    type: 'follow_accepted',
    title: 'Follow Request Accepted',
    body: `${me.displayName} accepted your follow request.`,
    linkUrl: `/profile/${me.username || me.uid}`,
    dedupeKey: `follow_acc_${me.uid}_${requesterUid}`,
  });
}

export async function declineFollowRequest(myUid: string, requesterUid: string): Promise<void> {
  await updateDoc(doc(db, 'followRequests', `${requesterUid}_${myUid}`), {
    status: 'declined',
    updatedAt: serverTimestamp(),
  });
}

export async function sendFriendRequest(me: BanaUser, targetUser: BanaUser): Promise<void> {
  if (me.uid === targetUser.uid) throw new Error('You cannot send a friend request to yourself.');
  const { blockedByMe, amIBlocked } = await checkPairBlocked(me.uid, targetUser.uid);
  if (blockedByMe || amIBlocked) {
    throw new Error('Cannot send a friend request due to block settings.');
  }

  const pairId = getFriendshipPairId(me.uid, targetUser.uid);
  const alreadyFriends = await getDoc(doc(db, 'friendships', pairId)).catch(() => null);
  if (alreadyFriends?.exists()) return;

  // An incoming pending request from the target is accepted instead of creating a crossing request.
  const incoming = await getDoc(doc(db, 'friendRequests', `${targetUser.uid}_${me.uid}`)).catch(() => null);
  if (incoming?.exists() && incoming.data()?.status === 'pending') {
    await acceptFriendRequest(me, targetUser.uid);
    return;
  }

  const reqId = `${me.uid}_${targetUser.uid}`;
  const existingReq = await getDoc(doc(db, 'friendRequests', reqId)).catch(() => null);
  if (existingReq?.exists()) {
    if (existingReq.data()?.status === 'pending') return;
    await deleteDoc(doc(db, 'friendRequests', reqId));
  }
  await setDoc(doc(db, 'friendRequests', reqId), {
    fromUid: me.uid,
    toUid: targetUser.uid,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await createSocialNotification({
    recipientId: targetUser.uid,
    actor: me,
    type: 'friend_request',
    title: 'Friend Request',
    body: `${me.displayName} sent you a friend request.`,
    linkUrl: `/profile/${me.username || me.uid}`,
    dedupeKey: `friend_req_${me.uid}_${targetUser.uid}`,
  });
}

export async function cancelFriendRequest(myUid: string, targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'friendRequests', `${myUid}_${targetUid}`));
}

export async function acceptFriendRequest(me: BanaUser, requesterUid: string): Promise<void> {
  const reqRef = doc(db, 'friendRequests', `${requesterUid}_${me.uid}`);
  const pairId = getFriendshipPairId(me.uid, requesterUid);
  // ATOMIC: request status + friendship pair + both friendLinks edges commit together or not at all.
  const batch = writeBatch(db);
  batch.update(reqRef, { status: 'accepted', updatedAt: serverTimestamp() });
  batch.set(doc(db, 'friendships', pairId), {
    participants: [me.uid, requesterUid].sort(),
    createdAt: serverTimestamp(),
  });
  batch.set(doc(db, 'friendLinks', `${me.uid}_${requesterUid}`), { ownerUid: me.uid, friendUid: requesterUid, createdAt: serverTimestamp() });
  batch.set(doc(db, 'friendLinks', `${requesterUid}_${me.uid}`), { ownerUid: requesterUid, friendUid: me.uid, createdAt: serverTimestamp() });
  await batch.commit();

  await createSocialNotification({
    recipientId: requesterUid,
    actor: me,
    type: 'friend_accepted',
    title: 'Friend Request Accepted',
    body: `${me.displayName} accepted your friend request.`,
    linkUrl: `/profile/${me.username || me.uid}`,
    dedupeKey: `friend_acc_${me.uid}_${requesterUid}`,
  });
}

export async function declineFriendRequest(myUid: string, requesterUid: string): Promise<void> {
  await updateDoc(doc(db, 'friendRequests', `${requesterUid}_${myUid}`), {
    status: 'declined',
    updatedAt: serverTimestamp(),
  });
}

export async function unfriendUser(myUid: string, targetUid: string): Promise<void> {
  const pairId = getFriendshipPairId(myUid, targetUid);
  await Promise.all([
    deleteDoc(doc(db, 'friendships', pairId)).catch(() => {}),
    deleteDoc(doc(db, 'friendLinks', `${myUid}_${targetUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'friendLinks', `${targetUid}_${myUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'friendRequests', `${myUid}_${targetUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'friendRequests', `${targetUid}_${myUid}`)).catch(() => {}),
  ]);
}

export async function blockUser(myUid: string, targetUid: string): Promise<void> {
  if (myUid === targetUid) return;
  await Promise.all([
    setDoc(doc(db, 'userBlocks', `${myUid}_${targetUid}`), {
      blockerId: myUid,
      blockedUid: targetUid,
      createdAt: serverTimestamp(),
    }),
    deleteDoc(doc(db, 'userFollows', `${myUid}_${targetUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'userFollows', `${targetUid}_${myUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'followRequests', `${myUid}_${targetUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'followRequests', `${targetUid}_${myUid}`)).catch(() => {}),
    unfriendUser(myUid, targetUid).catch(() => {}),
  ]);
}

export async function unblockUser(myUid: string, targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'userBlocks', `${myUid}_${targetUid}`));
}

export async function toggleRestrictUser(myUid: string, targetUid: string, currentlyRestricted: boolean): Promise<boolean> {
  const ref = doc(db, 'userRestrictions', `${myUid}_${targetUid}`);
  if (currentlyRestricted) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, {
    restrictorId: myUid,
    restrictedUid: targetUid,
    createdAt: serverTimestamp(),
  });
  return true;
}

/**
 * Friend ids of `uid`.
 *  - Own list (uid === signed-in user): read from the participant-only `friendships` pair docs + accepted requests, and any
 *    missing friendLinks edges are created in the background (lazy migration of pre-friendLinks data).
 *  - Anyone else's list: ONLY from `friendLinks` (where ownerUid == uid). Firestore Rules apply that owner's
 *    whoCanViewFriends / isPrivateAccount / block settings to every returned doc, so a denied list simply comes back empty.
 * `max` bounds the read (suggestions sample far fewer than the profile page).
 */
export async function getUserFriendIds(uid: string, max = 200): Promise<string[]> {
  if (!uid) return [];
  const me = auth.currentUser?.uid;
  const ids = new Set<string>();

  if (me && me === uid) {
    const [friendSnap, recAccepted, sentAccepted, linkSnap] = await Promise.all([
      getDocs(query(collection(db, 'friendships'), where('participants', 'array-contains', uid), limit(Math.max(max, 500)))).catch(() => null),
      getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', uid), where('status', '==', 'accepted'), limit(200))).catch(() => null),
      getDocs(query(collection(db, 'friendRequests'), where('fromUid', '==', uid), where('status', '==', 'accepted'), limit(200))).catch(() => null),
      getDocs(query(collection(db, 'friendLinks'), where('ownerUid', '==', uid), limit(Math.max(max, 500)))).catch(() => null),
    ]);
    friendSnap?.docs.forEach((d) => {
      const participants: string[] = Array.isArray(d.data().participants) ? d.data().participants : [];
      participants.forEach((p) => { if (p !== uid) ids.add(p); });
    });
    recAccepted?.docs.forEach((d) => { const f = d.data().fromUid; if (f && f !== uid) ids.add(f); });
    sentAccepted?.docs.forEach((d) => { const t = d.data().toUid; if (t && t !== uid) ids.add(t); });
    linkSnap?.docs.forEach((d) => { const f = d.data().friendUid; if (f && f !== uid) ids.add(f); });

    // Lazy backfill: friendships that predate friendLinks get their two edges (allowed: I am a participant of an existing pair).
    const linked = new Set((linkSnap?.docs || []).map((d) => String(d.data().friendUid)));
    const missing = (friendSnap?.docs || [])
      .flatMap((d) => (Array.isArray(d.data().participants) ? (d.data().participants as string[]) : []))
      .filter((p) => p !== uid && !linked.has(p));
    if (linkSnap && missing.length) void backfillFriendLinks(uid, Array.from(new Set(missing)).slice(0, 200));
    return Array.from(ids).slice(0, Math.max(max, ids.size));
  }

  const snap = await getDocs(query(collection(db, 'friendLinks'), where('ownerUid', '==', uid), limit(max))).catch(() => null);
  snap?.docs.forEach((d) => { const f = d.data().friendUid; if (f && f !== uid) ids.add(f); });
  return Array.from(ids);
}

async function backfillFriendLinks(me: string, friendUids: string[]): Promise<void> {
  try {
    for (let i = 0; i < friendUids.length; i += 100) {
      const batch = writeBatch(db);
      friendUids.slice(i, i + 100).forEach((f) => {
        batch.set(doc(db, 'friendLinks', `${me}_${f}`), { ownerUid: me, friendUid: f, createdAt: serverTimestamp() });
        batch.set(doc(db, 'friendLinks', `${f}_${me}`), { ownerUid: f, friendUid: me, createdAt: serverTimestamp() });
      });
      await batch.commit();
    }
  } catch {
    /* best-effort; never blocks the UI (a pair that cannot be linked simply stays unlisted for others) */
  }
}

export async function getMutualFriendIds(uidA: string, uidB: string): Promise<string[]> {
  if (!uidA || !uidB || uidA === uidB) return [];
  const [friendsA, friendsB] = await Promise.all([getUserFriendIds(uidA), getUserFriendIds(uidB)]);
  const setB = new Set(friendsB);
  return friendsA.filter((id) => setB.has(id));
}

export async function fetchUsersByIds(uids: string[]): Promise<BanaUser[]> {
  if (uids.length === 0) return [];
  const unique = Array.from(new Set(uids)).slice(0, 60);
  const snaps = await Promise.all(unique.map((id) => getDoc(doc(db, 'users', id)).catch(() => null)));
  return snaps
    .filter((s): s is NonNullable<typeof s> => Boolean(s?.exists()))
    .map((s) => s.data() as BanaUser)
    .filter((u) => u.accountStatus !== 'banned');
}

export async function recordDailyProfileView(profileUid: string, viewerUid: string): Promise<void> {
  if (!profileUid || !viewerUid || profileUid === viewerUid) return;
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const docId = `${profileUid}_${viewerUid}_${dayKey.replace(/-/g, '')}`;
  const ref = doc(db, 'profileViews', docId);
  const snap = await getDoc(ref).catch(() => null);
  if (snap && snap.exists()) return;
  await setDoc(ref, {
    profileUid,
    viewerUid,
    dayKey,
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

export async function fetchPendingSocialRequests(myUid: string): Promise<{
  incomingFriends: Array<{ req: FriendRequestRecord; user: BanaUser }>;
  sentFriends: Array<{ req: FriendRequestRecord; user: BanaUser }>;
  incomingFollows: Array<{ req: FollowRequestRecord; user: BanaUser }>;
}> {
  const [incFriendSnap, sentFriendSnap, incFollowSnap] = await Promise.all([
    getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', myUid), where('status', '==', 'pending'), limit(50))).catch(() => null),
    getDocs(query(collection(db, 'friendRequests'), where('fromUid', '==', myUid), where('status', '==', 'pending'), limit(50))).catch(() => null),
    getDocs(query(collection(db, 'followRequests'), where('toUid', '==', myUid), where('status', '==', 'pending'), limit(50))).catch(() => null),
  ]);

  const incFriends = incFriendSnap?.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequestRecord, 'id'>) })) || [];
  const sentFriends = sentFriendSnap?.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequestRecord, 'id'>) })) || [];
  const incFollows = incFollowSnap?.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FollowRequestRecord, 'id'>) })) || [];

  const allUids = [
    ...incFriends.map((r) => r.fromUid),
    ...sentFriends.map((r) => r.toUid),
    ...incFollows.map((r) => r.fromUid),
  ];
  const users = await fetchUsersByIds(allUids);
  const userMap = new Map(users.map((u) => [u.uid, u]));

  return {
    incomingFriends: incFriends.flatMap((req) => (userMap.has(req.fromUid) ? [{ req, user: userMap.get(req.fromUid)! }] : [])),
    sentFriends: sentFriends.flatMap((req) => (userMap.has(req.toUid) ? [{ req, user: userMap.get(req.toUid)! }] : [])),
    incomingFollows: incFollows.flatMap((req) => (userMap.has(req.fromUid) ? [{ req, user: userMap.get(req.fromUid)! }] : [])),
  };
}

export async function fetchSuggestedUsers(opts: {
  myProfile: BanaUser | null;
  blockedUids?: string[];
  dismissedUids?: string[];
  limitCount?: number;
}): Promise<SuggestedUserItem[]> {
  // Delegates to the configurable Friend Suggestions engine (dynamic import avoids a circular dependency).
  const { getFriendSuggestions } = await import('@/src/lib/friendSuggestions');
  const { items } = await getFriendSuggestions(opts);
  return items;
}
