import { auth } from '@/src/firebase';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function buildFirestoreErrorInfo(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  return {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export function logFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const errInfo = buildFirestoreErrorInfo(error, operationType, path);
  const isPermError =
    errInfo.error.includes('permission-denied') ||
    errInfo.error.includes('Missing or insufficient permissions');
  const isIndexError =
    errInfo.error.includes('requires an index') ||
    errInfo.error.includes('failed-precondition');
  if (isPermError) {
    console.warn('Firestore Permission Notice: ', JSON.stringify(errInfo));
  } else if (isIndexError) {
    console.warn('Firestore Index Notice: ', JSON.stringify(errInfo));
  } else {
    console.error('Firestore Error: ', JSON.stringify(errInfo));
  }
  return errInfo;
}

export function formatFirebaseErrorMessage(error: unknown): string {
  if (!error) return 'An unexpected error occurred.';
  const raw = error instanceof Error ? error.message : String(error);
  const code = (error as any)?.code || '';

  if (code === 'auth/email-already-in-use') return 'An account with this email already exists.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return 'Invalid email or password.';
  if (code === 'auth/user-not-found') return 'No account found with this email address.';
  if (code === 'auth/weak-password') return 'Password must be at least 6 characters long.';
  if (code === 'auth/popup-closed-by-user') return 'Sign-in popup was closed before completing.';
  if (code === 'auth/operation-not-allowed') {
    return 'This sign-in provider is not enabled yet in Firebase Console -> Authentication -> Sign-in method.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This preview domain needs to be added to Firebase Console -> Authentication -> Settings -> Authorized domains.';
  }
  if (code === 'failed-precondition' || raw.includes('requires an index')) {
    return 'A Firestore composite index is required on bana-a5770 for this sorted query. Deploy indexes with: firebase deploy --only firestore:indexes';
  }
  if (code === 'storage/unauthorized' || code === 'storage/unauthenticated') {
    return 'Storage upload denied. Verify your account email or ensure Firebase Storage rules are deployed.';
  }
  if (code === 'storage/bucket-not-found' || raw.includes('bucket-not-found')) {
    return 'Firebase Storage bucket is not provisioned yet on this project (newer Cloud Storage buckets may require upgrading Firebase from Spark to Blaze or linking a valid bucket).';
  }
  if (code === 'storage/quota-exceeded' || code === 'resource-exhausted' || raw.includes('Quota exceeded')) {
    return 'Daily Firebase Spark Free Plan quota exceeded. Please reduce media size or try again after quota reset.';
  }
  if (raw.includes('permission-denied') || raw.includes('Missing or insufficient permissions')) {
    return 'Missing or insufficient Firestore permissions. Ensure firestore.rules are deployed to bana-a5770 and your email is verified.';
  }
  return raw;
}
