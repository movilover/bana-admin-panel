import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  runTransaction,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import type { User as FirebaseAuthUser } from 'firebase/auth';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import { fetchLiveFollowCounts } from '@/src/lib/socialCounts';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';
import type {
  BanaUser,
  BanaUserSettings,
  CreatorApplication,
  CreatorApplicationHistoryEntry,
  CreatorEarning,
  CreatorEligibilityRecord,
  CreatorPayoutProfile,
  EarningEvent,
  FinancialTransaction,
  MonetizationPolicy,
  PayoutRequest,
} from '@/src/types/bana';

export const DEFAULT_MONETIZATION_POLICY: MonetizationPolicy = {
  id: 'default',
  monetizationEnabled: true,
  creatorSharePct: 55,
  platformSharePct: 45,
  minFollowers: 1000,
  minPayoutUsd: 10,
  qualifiedViewMinSeconds: 5,
  requireEmailVerified: true,
  requireOriginalContent: true,
  requireAdultAge: true,
  eligibleRegions: ['Bangladesh', 'Global'],
  payoutMethodsEnabled: ['bKash', 'Nagad', 'Bank Transfer'],
  policySummary:
    'Creators who reach at least 1,000 genuine followers, publish original content, verify their account, meet the 18+ legal age requirement, and maintain good community standing may apply for BANA Creator Monetization. Approval is reviewed by BANA administrators and revenue share is governed by active platform monetization policies.',
  adPoolCpmUsd: 0,
};

export function isFunctionsFallbackError(err: any): boolean {
  const code = String(err?.code || '');
  const msg = String(err?.message || '').toLowerCase();
  return (
    code === 'functions/not-found' ||
    code === 'functions/unavailable' ||
    code === 'functions/internal' ||
    msg.includes('not-found') ||
    msg.includes('unavailable') ||
    msg.includes('cors') ||
    msg.includes('network')
  );
}

export async function fetchMonetizationPolicy(): Promise<MonetizationPolicy> {
  try {
    const [policySnap, legacySnap, providersSnap] = await Promise.all([
      getDoc(doc(db, 'monetizationPolicies', 'default')),
      getDoc(doc(db, 'adminSettings', 'monetization')).catch(() => null),
      getDoc(doc(db, 'adminSettings', 'payoutProviders')).catch(() => null),
    ]);

    const base = { ...DEFAULT_MONETIZATION_POLICY };

    if (legacySnap?.exists()) {
      const l = legacySnap.data();
      if (typeof l.minFollowers === 'number') base.minFollowers = l.minFollowers;
      if (typeof l.minWithdrawalUsd === 'number') base.minPayoutUsd = l.minWithdrawalUsd;
    }

    if (providersSnap?.exists()) {
      const enabled = providersSnap.data()?.enabledMethods;
      if (Array.isArray(enabled) && enabled.length > 0) {
        base.payoutMethodsEnabled = enabled.map(String);
      }
    }

    if (policySnap.exists()) {
      const p = policySnap.data() as Partial<MonetizationPolicy>;
      return {
        ...base,
        ...p,
        id: 'default',
        creatorSharePct: Number(p.creatorSharePct ?? base.creatorSharePct),
        platformSharePct: Number(p.platformSharePct ?? base.platformSharePct),
        minFollowers: Number(p.minFollowers ?? base.minFollowers),
        minPayoutUsd: Number(p.minPayoutUsd ?? base.minPayoutUsd),
        qualifiedViewMinSeconds: Number(p.qualifiedViewMinSeconds ?? base.qualifiedViewMinSeconds),
        eligibleRegions:
          Array.isArray(p.eligibleRegions) && p.eligibleRegions.length > 0
            ? p.eligibleRegions
            : base.eligibleRegions,
        payoutMethodsEnabled:
          Array.isArray(p.payoutMethodsEnabled) && p.payoutMethodsEnabled.length > 0
            ? p.payoutMethodsEnabled
            : base.payoutMethodsEnabled,
      };
    }

    return base;
  } catch {
    return DEFAULT_MONETIZATION_POLICY;
  }
}

export function computeEligibilityDeterministic(params: {
  uid: string;
  profile: BanaUser;
  settings: BanaUserSettings | null;
  firebaseUser: FirebaseAuthUser;
  postsCount: number;
  reelsCount: number;
  policy: MonetizationPolicy;
  application: CreatorApplication | null;
}): CreatorEligibilityRecord {
  const { uid, profile, settings, firebaseUser, postsCount, reelsCount, policy, application } = params;
  const followersCount = Number(profile.followersCount || 0);
  const currentYear = new Date().getFullYear();
  const isAdult = settings?.birthYear
    ? currentYear - settings.birthYear >= 18
    : !profile.isMinor;
  const isEmailVerified = Boolean(
    firebaseUser.emailVerified || firebaseUser.providerData?.some((p) => p.providerId === 'google.com')
  );
  const hasOriginalContent = postsCount + reelsCount >= 1;
  const isGoodStanding = profile.accountStatus === 'active';
  // Region check against the admin-configured policy.eligibleRegions ('Global' = open to everyone).
  const regionText = `${(settings as { country?: string } | null)?.country || ''} ${profile.location || ''}`.toLowerCase();
  const eligibleRegions = policy.eligibleRegions && policy.eligibleRegions.length > 0 ? policy.eligibleRegions : ['Global'];
  const regionEligible = eligibleRegions.some(
    (r) => r.toLowerCase() === 'global' || (regionText.trim().length > 0 && regionText.includes(r.toLowerCase()))
  );
  const policyCompliant = isGoodStanding && !profile.messagingRestricted;

  const outstanding: string[] = [];
  if (followersCount < policy.minFollowers) {
    outstanding.push(`Reach at least ${policy.minFollowers.toLocaleString()} genuine followers`);
  }
  if (policy.requireAdultAge && !isAdult) {
    outstanding.push('Account holder must meet 18+ legal age requirement');
  }
  if (policy.requireEmailVerified && !isEmailVerified) {
    outstanding.push('Verify your account email address');
  }
  if (policy.requireOriginalContent && !hasOriginalContent) {
    outstanding.push('Publish original posts or Reels on BANA');
  }
  if (!isGoodStanding) {
    outstanding.push('Account must be in active standing without policy restrictions');
  }
  if (!regionEligible) {
    outstanding.push(`Monetization is available in: ${eligibleRegions.join(', ')}. Add your country to your profile location.`);
  }

  let monetizationStatus: CreatorEligibilityRecord['monetizationStatus'] =
    outstanding.length === 0 ? 'eligible' : 'not_eligible';

  if (application) {
    if (application.status === 'approved' && profile.isCreator) {
      monetizationStatus = 'approved';
    } else if (application.status === 'suspended') {
      monetizationStatus = 'suspended';
    } else if (application.status === 'needs_info') {
      monetizationStatus = 'needs_info';
    } else if (application.status === 'rejected') {
      monetizationStatus = 'rejected';
    } else if (application.status === 'pending' || application.status === 'appealed') {
      monetizationStatus = 'pending';
    }
  } else if (profile.isCreator) {
    monetizationStatus = 'approved';
  }

  const eligibleToApply =
    outstanding.length === 0 &&
    policy.monetizationEnabled &&
    (!application || application.status === 'rejected');

  return {
    uid,
    followersCount,
    requiredFollowers: policy.minFollowers,
    isAdult,
    isEmailVerified,
    hasOriginalContent,
    isGoodStanding,
    regionEligible,
    policyCompliant,
    eligibleToApply,
    monetizationStatus,
    outstandingRequirements: outstanding,
  };
}

export async function evaluateCreatorEligibilityClientOrServer(params: {
  uid: string;
  profile: BanaUser;
  settings: BanaUserSettings | null;
  firebaseUser: FirebaseAuthUser;
  postsCount: number;
  reelsCount: number;
  policy: MonetizationPolicy;
  application: CreatorApplication | null;
}): Promise<CreatorEligibilityRecord> {
  try {
    const res = await invokeCloudFunction<Record<string, never>, CreatorEligibilityRecord>(
      'evaluateCreatorEligibility',
      {}
    );
    if (res && res.uid) {
      return res;
    }
  } catch {
    // Graceful read-only deterministic evaluation in Spark mode or when Cloud Functions are unavailable
  }
  // Spark mode: the stored follower counter is only maintained by Cloud Functions, so count the real follows.
  const live = await fetchLiveFollowCounts(params.uid);
  return computeEligibilityDeterministic(
    live ? { ...params, profile: { ...params.profile, followersCount: live.followers } } : params
  );
}

export async function submitCreatorApplication(params: {
  uid: string;
  username: string;
  displayName: string;
  followerCountAtApply: number;
  country: string;
  payoutCategory: string;
  originalContentAttested: boolean;
  policiesAccepted: boolean;
  regionalComplianceAttested: boolean;
}): Promise<{ applicationId: string; status: 'pending' }> {
  try {
    const res = await invokeCloudFunction<Record<string, unknown>, { applicationId?: string }>(
      'submitMonetizationApplication',
      {
        country: params.country,
        payoutCategory: params.payoutCategory,
        originalContentAttested: params.originalContentAttested,
        policiesAccepted: params.policiesAccepted,
        regionalComplianceAttested: params.regionalComplianceAttested,
      }
    );
    return {
      applicationId: String(res?.applicationId || ''),
      status: 'pending',
    };
  } catch (err: any) {
    if (!isFunctionsFallbackError(err)) throw err;
    const history: CreatorApplicationHistoryEntry[] = [
      {
        status: 'pending',
        note: 'Creator submitted monetization application',
        actorUid: params.uid,
        at: new Date().toISOString(),
      },
    ];
    const ref = await addDoc(collection(db, 'creatorApplications'), {
      uid: params.uid,
      username: params.username,
      displayName: params.displayName,
      followerCountAtApply: params.followerCountAtApply,
      country: params.country.trim(),
      payoutCategory: params.payoutCategory.trim(),
      originalContentAttested: true,
      policiesAccepted: true,
      regionalComplianceAttested: params.regionalComplianceAttested,
      status: 'pending',
      history,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return { applicationId: ref.id, status: 'pending' };
  }
}

export async function respondOrAppealApplication(params: {
  application: CreatorApplication;
  uid: string;
  mode: 'appeal' | 'needs_info_response';
  note: string;
  country?: string;
  payoutCategory?: string;
}): Promise<void> {
  const { application, uid, mode, note, country, payoutCategory } = params;
  const cleanNote = note.trim().slice(0, 500);
  const existingHistory = Array.isArray(application.history) ? application.history : [];
  const nextStatus = mode === 'appeal' ? 'appealed' : 'pending';
  const entry: CreatorApplicationHistoryEntry = {
    status: mode === 'appeal' ? 'appealed' : 'pending',
    note: cleanNote,
    actorUid: uid,
    at: new Date().toISOString(),
  };

  const payload: Record<string, any> = {
    status: nextStatus,
    history: [...existingHistory, entry],
    updatedAt: serverTimestamp(),
  };

  if (mode === 'appeal') {
    payload.appealNote = cleanNote;
  } else {
    payload.userResponseNote = cleanNote;
    if (country) payload.country = country.trim();
    if (payoutCategory) payload.payoutCategory = payoutCategory.trim();
  }

  await updateDoc(doc(db, 'creatorApplications', application.id), payload);
}

export async function saveCreatorPayoutProfile(params: {
  uid: string;
  preferredMethod: string;
  accountHolderName: string;
  accountIdentifier: string;
  bankName?: string;
  branchName?: string;
  country: string;
  taxResidencyNote?: string;
}): Promise<CreatorPayoutProfile> {
  const rawId = params.accountIdentifier.trim();
  const masked =
    rawId.length > 4
      ? `${'*'.repeat(Math.min(8, Math.max(2, rawId.length - 4)))}${rawId.slice(-4)}`
      : rawId;

  const docData: CreatorPayoutProfile = {
    uid: params.uid,
    preferredMethod: params.preferredMethod.trim(),
    accountHolderName: params.accountHolderName.trim().slice(0, 100),
    accountIdentifierMasked: masked.slice(0, 80),
    bankName: (params.bankName || '').trim().slice(0, 100),
    branchName: (params.branchName || '').trim().slice(0, 100),
    country: params.country.trim().slice(0, 60),
    taxResidencyNote: (params.taxResidencyNote || '').trim().slice(0, 160),
    verifiedForPayouts: false,
    updatedAt: serverTimestamp(),
  };

  // Security note: never store card numbers, CVV, or raw PAN fields
  await setDoc(doc(db, 'creatorPayoutProfiles', params.uid), docData, { merge: true });
  return docData;
}

export async function submitCreatorPayoutRequest(params: {
  uid: string;
  amountUsd: number;
  method: string;
  accountLabel: string;
  accountHolderName?: string;
  country: string;
}): Promise<{ payoutId: string }> {
  try {
    const res = await invokeCloudFunction<Record<string, unknown>, { payoutId?: string }>(
      'requestCreatorPayout',
      {
        amountUsd: params.amountUsd,
        method: params.method,
        accountLabel: params.accountLabel,
        accountHolderName: params.accountHolderName || '',
        country: params.country,
      }
    );
    return { payoutId: String(res?.payoutId || '') };
  } catch (err: any) {
    if (isFunctionsFallbackError(err)) {
      // Payout requests reserve balance, so they can only be created by the trusted backend that
      // recomputes the confirmed balance. There is intentionally NO client-side fallback.
      throw new Error(
        'Payout requests need the BANA server (Cloud Functions) to verify your confirmed balance. It is not enabled on this deployment yet.'
      );
    }
    throw err;
  }
}

export function getOrCreateSessionKey(): string {
  try {
    const existing = sessionStorage.getItem('bana_session_key');
    if (existing) return existing;
    const next = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem('bana_session_key', next);
    return next;
  } catch {
    return `sess_${Date.now()}`;
  }
}

export async function recordQualifiedView(
  contentType: 'reel' | 'video' | 'post',
  contentId: string,
  watchSeconds: number
): Promise<boolean> {
  if (!contentId || watchSeconds < 4) return false;
  const throttleKey = `bana_qv_${contentType}_${contentId}`;
  try {
    if (sessionStorage.getItem(throttleKey)) return false;
    sessionStorage.setItem(throttleKey, '1');
  } catch {
    // Ignore storage issues in restricted frames
  }

  try {
    const res = await invokeCloudFunction<Record<string, unknown>, { counted?: boolean }>(
      'recordQualifiedContentView',
      {
        contentType,
        contentId,
        watchSeconds,
        sessionKey: getOrCreateSessionKey(),
      }
    );
    return Boolean(res?.counted);
  } catch {
    return false;
  }
}

export interface EarningsSummary {
  estimatedUsd: number;
  confirmedUsd: number;
  pendingEarningsUsd: number;
  adjustmentsUsd: number;
  reservedOrPaidPayoutsUsd: number;
  paidOutUsd: number;
  availableBalanceUsd: number;
  totalQualifiedViews: number;
  totalWatchSeconds: number;
}

export function computeEarningsSummary(
  events: EarningEvent[],
  earnings: CreatorEarning[],
  payouts: PayoutRequest[]
): EarningsSummary {
  const estimatedFromEvents = events.reduce((s, ev) => s + Number(ev.estimatedAmountUsd || 0), 0);
  const estimatedFromLedger = earnings
    .filter((e) => e.status === 'estimated')
    .reduce((s, e) => s + Number(e.amountUsd || 0), 0);
  const estimatedUsd = Number((estimatedFromEvents + estimatedFromLedger).toFixed(2));

  const confirmedUsd = Number(
    earnings
      .filter((e) => e.status === 'confirmed' || e.status === 'approved' || e.status === 'paid')
      .reduce((s, e) => s + Number(e.amountUsd || 0), 0)
      .toFixed(2)
  );

  const pendingEarningsUsd = Number(
    earnings
      .filter((e) => e.status === 'pending')
      .reduce((s, e) => s + Number(e.amountUsd || 0), 0)
      .toFixed(2)
  );

  const adjustmentsUsd = Number(
    earnings
      .filter((e) => e.status === 'adjusted' || e.sourceType === 'adjustment')
      .reduce((s, e) => s + Number(e.amountUsd || 0), 0)
      .toFixed(2)
  );

  const reservedOrPaidPayoutsUsd = Number(
    payouts
      .filter((p) => ['pending', 'approved', 'processing', 'completed', 'paid'].includes(p.status))
      .reduce((s, p) => s + Number(p.amountUsd || 0), 0)
      .toFixed(2)
  );

  const paidOutUsd = Number(
    payouts
      .filter((p) => p.status === 'paid' || p.status === 'completed')
      .reduce((s, p) => s + Number(p.amountUsd || 0), 0)
      .toFixed(2)
  );

  // Only confirmed/approved/adjusted earnings are eligible for payout — never estimated amounts
  const withdrawableGross = earnings
    .filter((e) => ['confirmed', 'approved', 'paid', 'adjusted'].includes(e.status))
    .reduce((s, e) => s + Number(e.amountUsd || 0), 0);

  const availableBalanceUsd = Math.max(0, Number((withdrawableGross - reservedOrPaidPayoutsUsd).toFixed(2)));

  const totalQualifiedViews = events.reduce((s, ev) => s + Number(ev.qualifiedViews || 0), 0);
  const totalWatchSeconds = events.reduce((s, ev) => s + Number(ev.watchSeconds || 0), 0);

  return {
    estimatedUsd,
    confirmedUsd,
    pendingEarningsUsd,
    adjustmentsUsd,
    reservedOrPaidPayoutsUsd,
    paidOutUsd,
    availableBalanceUsd,
    totalQualifiedViews,
    totalWatchSeconds,
  };
}

export async function fetchCreatorLedgerData(uid: string): Promise<{
  events: EarningEvent[];
  earnings: CreatorEarning[];
  payouts: PayoutRequest[];
  transactions: FinancialTransaction[];
  payoutProfile: CreatorPayoutProfile | null;
}> {
  const [evRes, earnRes, payReqRes, cpRes, txRes, profSnap] = await Promise.all([
    getDocsWithIndexFallback<EarningEvent>(
      query(collection(db, 'earningEvents'), where('uid', '==', uid), orderBy('createdAt', 'desc')),
      query(collection(db, 'earningEvents'), where('uid', '==', uid)),
      sortByCreatedAtDesc
    ).catch(() => null),
    getDocsWithIndexFallback<CreatorEarning>(
      query(collection(db, 'creatorEarnings'), where('uid', '==', uid), orderBy('createdAt', 'desc')),
      query(collection(db, 'creatorEarnings'), where('uid', '==', uid)),
      sortByCreatedAtDesc
    ).catch(() => null),
    getDocsWithIndexFallback<PayoutRequest>(
      query(collection(db, 'payoutRequests'), where('uid', '==', uid), orderBy('createdAt', 'desc')),
      query(collection(db, 'payoutRequests'), where('uid', '==', uid)),
      sortByCreatedAtDesc
    ).catch(() => null),
    getDocsWithIndexFallback<PayoutRequest>(
      query(collection(db, 'creatorPayouts'), where('uid', '==', uid), orderBy('createdAt', 'desc')),
      query(collection(db, 'creatorPayouts'), where('uid', '==', uid)),
      sortByCreatedAtDesc
    ).catch(() => null),
    getDocsWithIndexFallback<FinancialTransaction>(
      query(collection(db, 'financialTransactions'), where('uid', '==', uid), orderBy('createdAt', 'desc')),
      query(collection(db, 'financialTransactions'), where('uid', '==', uid)),
      sortByCreatedAtDesc
    ).catch(() => null),
    getDoc(doc(db, 'creatorPayoutProfiles', uid)).catch(() => null),
  ]);

  const events = evRes ? evRes.items : [];
  const earnings = earnRes ? earnRes.items : [];

  // Merge payoutRequests and creatorPayouts cleanly by ID
  const payoutMap = new Map<string, PayoutRequest>();
  payReqRes?.items.forEach((p) => payoutMap.set(p.id, p));
  cpRes?.items.forEach((p) => {
    if (!payoutMap.has(p.id)) {
      payoutMap.set(p.id, p);
    }
  });
  const payouts = Array.from(payoutMap.values()).sort(sortByCreatedAtDesc);

  const transactions = txRes ? txRes.items : [];

  const payoutProfile = profSnap?.exists() ? (profSnap.data() as CreatorPayoutProfile) : null;

  return { events, earnings, payouts, transactions, payoutProfile };
}


// =========================================================================
// Prompt 08 — Policy change history (immutable; historical earnings untouched)
// =========================================================================
const POLICY_TRACKED_KEYS_MONETIZATION = [
  'monetizationEnabled', 'creatorSharePct', 'platformSharePct', 'minFollowers', 'minPayoutUsd',
  'qualifiedViewMinSeconds', 'requireEmailVerified', 'requireOriginalContent', 'requireAdultAge',
  'eligibleRegions', 'payoutMethodsEnabled', 'policySummary', 'programTerms', 'contentRequirements', 'adPoolCpmUsd',
];

export function diffPolicy(
  before: Record<string, any>,
  after: Record<string, any>,
  keys: string[]
): { changedFields: string[]; before: Record<string, any>; after: Record<string, any> } {
  const changedFields: string[] = [];
  const b: Record<string, any> = {};
  const a: Record<string, any> = {};
  for (const k of keys) {
    if (JSON.stringify(before?.[k] ?? null) !== JSON.stringify(after?.[k] ?? null)) {
      changedFields.push(k);
      b[k] = before?.[k] ?? null;
      a[k] = after?.[k] ?? null;
    }
  }
  return { changedFields, before: b, after: a };
}

/**
 * Saves a monetization/advertising policy, bumps its version and appends an immutable
 * policyChangeHistory record. Existing earnings/ledger rows are NOT rewritten: they keep the
 * numbers they were computed with. Returns the new version, or null when nothing changed.
 */
export async function savePolicyWithHistory(params: {
  policyType: 'monetization' | 'advertising';
  collectionName: 'monetizationPolicies' | 'advertisingSettings';
  policyId: string;
  before: Record<string, any>;
  next: Record<string, any>;
  trackedKeys?: string[];
  adminUid: string;
  adminName?: string;
  reason: string;
}): Promise<number | null> {
  const keys = params.trackedKeys || POLICY_TRACKED_KEYS_MONETIZATION;
  const reason = params.reason.trim();
  if (reason.length < 3) throw new Error('A short reason is required for every financial policy change.');

  const ref = doc(db, params.collectionName, params.policyId);
  // The diff is computed against the STORED document inside the transaction (not the admin's
  // possibly stale in-memory copy), so concurrent edits can never produce a wrong before/after record.
  const result = await runTransaction(db, async (tx) => {
    const cur = await tx.get(ref);
    const stored: Record<string, any> = cur.exists() ? (cur.data() as Record<string, any>) : params.before;
    const d = diffPolicy(stored, params.next, keys);
    if (!d.changedFields.length) return null;
    const nextVersion = Number(stored.policyVersion || 0) + 1;
    tx.set(
      ref,
      { ...params.next, id: params.policyId, policyVersion: nextVersion, updatedBy: params.adminUid, updatedAt: serverTimestamp() },
      { merge: true }
    );
    return { version: nextVersion, diff: d };
  });
  if (!result) return null;

  await addDoc(collection(db, 'policyChangeHistory'), {
    policyType: params.policyType,
    policyId: params.policyId,
    version: result.version,
    changedBy: params.adminUid,
    changedByName: params.adminName || '',
    changedFields: result.diff.changedFields,
    before: result.diff.before,
    after: result.diff.after,
    reason,
    createdAt: serverTimestamp(),
  });
  return result.version;
}
