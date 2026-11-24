import { collection, getCountFromServer, query, where } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { CLOUD_FUNCTIONS_ENABLED } from '@/src/lib/firebasePlan';

/**
 * Live follower/following counts for the Firebase Spark plan.
 *
 * The stored `users/{uid}.followersCount` is maintained by the `onFollowCreated` / `onFollowDeleted` Cloud
 * Functions, which do not run on Spark. Here the real numbers are counted straight from the `userFollows`
 * documents using Firestore's count aggregation (billed as roughly one read per 1,000 matching documents).
 *
 * Returns null when Cloud Functions are enabled (the stored counters are then authoritative) or on any error.
 */
export async function fetchLiveFollowCounts(uid: string): Promise<{ followers: number; following: number } | null> {
  if (CLOUD_FUNCTIONS_ENABLED || !uid) return null;
  try {
    const [followers, following] = await Promise.all([
      getCountFromServer(query(collection(db, 'userFollows'), where('followingId', '==', uid))),
      getCountFromServer(query(collection(db, 'userFollows'), where('followerId', '==', uid))),
    ]);
    return { followers: followers.data().count, following: following.data().count };
  } catch {
    return null;
  }
}
