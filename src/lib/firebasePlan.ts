import { httpsCallable } from 'firebase/functions';
import { functions } from '@/src/firebase';

export type FirebasePlanMode = 'spark' | 'blaze';

const rawPlan = String(import.meta.env.VITE_FIREBASE_PLAN_MODE || 'spark').toLowerCase();

/**
 * Current Firebase billing architecture mode.
 * Defaults strictly to 'spark' (Free Plan Only) unless explicitly switched to 'blaze'.
 */
export const FIREBASE_PLAN_MODE: FirebasePlanMode = rawPlan === 'blaze' ? 'blaze' : 'spark';

/**
 * Cloud Functions (v2 / Gen 2) require the Firebase Blaze plan.
 * Keep this false on Spark so the client avoids unnecessary 404/CORS calls and routes
 * cleanly through rule-enforced Firestore client paths or manual review queues.
 */
export const CLOUD_FUNCTIONS_ENABLED: boolean =
  import.meta.env.VITE_ENABLE_CLOUD_FUNCTIONS === 'true' && FIREBASE_PLAN_MODE === 'blaze';

/**
 * Published Firebase Spark (No-Cost) daily & monthly quotas for client optimization & awareness.
 */
export const SPARK_QUOTAS = {
  authFreeMauLimit: 50_000,
  firestoreReadsPerDay: 50_000,
  firestoreWritesPerDay: 20_000,
  firestoreDeletesPerDay: 20_000,
  firestoreStorageGiB: 1,
  firestoreEgressGiBPerMonth: 10,
  hostingStorageGB: 10,
  hostingTransferMBPerDay: 360,
  storageLegacyFreeGB: 5,
  recommendedSparkVideoMaxMB: 35,
} as const;

export class CloudFunctionsDisabledError extends Error {
  readonly code = 'functions/unavailable';
  constructor(fnName: string) {
    super(`Cloud Function "${fnName}" is disabled in Spark Free Plan mode.`);
    this.name = 'CloudFunctionsDisabledError';
  }
}

/**
 * Invokes an optional Firebase Cloud Function ONLY when Blaze + Cloud Functions are enabled.
 * On Spark Plan, immediately throws a lightweight local error caught by BANA's
 * Spark/Blaze adapter pattern—zero wasted network round-trips or browser console 404s.
 */
export async function invokeCloudFunction<Req = unknown, Res = unknown>(
  name: string,
  payload?: Req
): Promise<Res> {
  if (!CLOUD_FUNCTIONS_ENABLED) {
    throw new CloudFunctionsDisabledError(name);
  }
  const fn = httpsCallable<Req, Res>(functions, name);
  const result = await fn(payload as Req);
  return result.data;
}

/**
 * Lightweight sessionStorage TTL cache helper to reduce redundant Firestore reads on Spark.
 */
export function readSessionCache<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; data: T };
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > maxAgeMs) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function writeSessionCache<T>(key: string, data: T): void {
  try {
    sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data }));
  } catch {
    // Ignore quota/storage errors in private browsing or restricted iframes
  }
}
