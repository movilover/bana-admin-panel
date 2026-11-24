import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  limit,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import {
  PAYMENT_METHOD_IDS,
  PAYMENT_METHOD_LABELS,
  type PaidVerificationApplication,
  type PaidVerificationHistoryEntry,
  type PaidVerificationStatus,
  type PaymentMethodId,
  type UserVerificationState,
  type VerificationConfig,
  type VerificationStatusDoc,
} from '@/src/types/paidVerification';
import {
  buildTransactionKey,
  formatMoney,
  normalizeConfig,
  normalizeSenderNumber,
  normalizeTransactionId,
  toMillis,
  validateSubmission,
  type SubmissionInput,
} from '@/src/lib/paidVerificationCore';

export * from '@/src/lib/paidVerificationCore';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

const configRef = () => doc(db, 'verificationConfig', 'settings');

/** Never returns a hard-coded fee or number: an unconfigured system is simply "disabled". */
export function subscribeVerificationConfig(
  cb: (cfg: VerificationConfig | null) => void,
  onError?: (e: unknown) => void
): () => void {
  return onSnapshot(
    configRef(),
    (snap) => cb(snap.exists() ? normalizeConfig(snap.data()) : null),
    (e) => {
      onError?.(e);
      cb(null);
    }
  );
}

export async function saveVerificationConfig(cfg: VerificationConfig, actorUid: string): Promise<void> {
  await setDoc(configRef(), {
    enabled: cfg.enabled,
    feeAmount: cfg.feeAmount,
    currency: cfg.currency,
    generalInstructions: cfg.generalInstructions.slice(0, 1500),
    methods: Object.fromEntries(
      PAYMENT_METHOD_IDS.map((id) => [
        id,
        {
          enabled: cfg.methods[id].enabled,
          number: cfg.methods[id].number.trim().slice(0, 30),
          accountType: cfg.methods[id].accountType,
          instructions: cfg.methods[id].instructions.slice(0, 1000),
        },
      ])
    ),
    updatedBy: actorUid,
    updatedAt: serverTimestamp(),
  });
}

/* ------------------------------------------------------------------ */
/* User side                                                           */
/* ------------------------------------------------------------------ */

export function subscribeMyVerification(
  uid: string,
  cb: (state: { status: VerificationStatusDoc | null; applications: PaidVerificationApplication[] }) => void,
  onError?: (e: unknown) => void
): () => void {
  let status: VerificationStatusDoc | null = null;
  let applications: PaidVerificationApplication[] = [];
  const emit = () => cb({ status, applications });
  const unsubStatus = onSnapshot(
    doc(db, 'verificationStatus', uid),
    (snap) => {
      status = snap.exists() ? (snap.data() as VerificationStatusDoc) : null;
      emit();
    },
    (e) => onError?.(e)
  );
  // Single-field filter only → no composite index needed; sorted client-side.
  const unsubApps = onSnapshot(
    query(collection(db, 'paidVerificationApplications'), where('uid', '==', uid), limit(50)),
    (snap) => {
      applications = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Omit<PaidVerificationApplication, 'id'>) }))
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      emit();
    },
    (e) => onError?.(e)
  );
  return () => {
    unsubStatus();
    unsubApps();
  };
}

export class VerificationSubmitError extends Error {}

export async function submitPaidVerification(params: {
  uid: string;
  username: string;
  displayName: string;
  input: SubmissionInput;
  config: VerificationConfig;
}): Promise<string> {
  const { uid, input, config } = params;
  const errors = validateSubmission(input, config);
  if (Object.keys(errors).length) throw new VerificationSubmitError(Object.values(errors)[0] as string);

  const method = input.method as PaymentMethodId;
  const transactionId = normalizeTransactionId(input.transactionId);
  const transactionKey = buildTransactionKey(method, transactionId);
  const appRef = doc(collection(db, 'paidVerificationApplications'));
  const at = new Date().toISOString();

  const batch = writeBatch(db);
  // 1) the application (amount/method/status are re-validated by firestore.rules against verificationConfig)
  batch.set(appRef, {
    uid,
    username: params.username.slice(0, 40),
    displayName: params.displayName.slice(0, 80),
    method,
    transactionId,
    transactionKey,
    senderNumber: normalizeSenderNumber(input.senderNumber),
    amount: Number(input.amount),
    currency: config.currency,
    reference: input.reference.trim().slice(0, 300),
    status: 'payment_pending',
    history: [{ status: 'payment_pending', note: 'Payment details submitted by user.', actorUid: uid, at }],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  // 2) the user's status pointer
  batch.set(doc(db, 'verificationStatus', uid), {
    uid,
    status: 'payment_pending',
    applicationId: appRef.id,
    updatedAt: serverTimestamp(),
  });
  // 3) uniqueness lock: creating an already-existing claim doc is an UPDATE, which rules deny →
  //    the whole batch (including the application) fails atomically.
  batch.set(doc(db, 'paymentClaims', transactionKey), {
    uid,
    applicationId: appRef.id,
    method,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err: any) {
    if (err?.code === 'permission-denied') {
      // Re-read config to give the most useful explanation without leaking whether someone else used the ID.
      const fresh = await getDoc(configRef()).then((s) => (s.exists() ? normalizeConfig(s.data()) : null)).catch(() => null);
      if (!fresh || !fresh.enabled) throw new VerificationSubmitError('Profile verification is currently unavailable.');
      if (!fresh.methods[method]?.enabled) throw new VerificationSubmitError(`${PAYMENT_METHOD_LABELS[method]} is no longer accepted. Pick another method.`);
      if (fresh.feeAmount !== Number(input.amount))
        throw new VerificationSubmitError(`The fee has changed to ${formatMoney(fresh.feeAmount, fresh.currency)}. Please review and resubmit.`);
      throw new VerificationSubmitError(
        'This transaction ID cannot be submitted. It may already have been used, or you may already have an open application.'
      );
    }
    throw new VerificationSubmitError('Could not submit right now. Please try again.');
  }
  return appRef.id;
}

/* ------------------------------------------------------------------ */
/* Admin side — every write is double-enforced by firestore.rules      */
/* ------------------------------------------------------------------ */

/** Actor details stamped on audit records. The audit document itself is staged in the SAME batch as the change. */
export interface AuditCtx {
  actorEmail?: string;
  actorRole?: string;
}

const redactSummary = (summary: string) =>
  String(summary || '')
    .replace(/(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 500);

/**
 * Stage an audit record inside the caller's batch so the status change and its audit entry commit atomically
 * (Firestore Rules additionally REQUIRE the record via existsAfter()/getAfter(), see pvAuditOk()).
 * Id convention: <applicationId>_<status> (deterministic, so a transition can be audited at most once).
 */
function stageAudit(
  batch: ReturnType<typeof writeBatch>,
  auditId: string,
  actorUid: string,
  ctx: AuditCtx,
  action: string,
  targetType: string,
  targetId: string,
  summary: string
) {
  batch.set(doc(db, 'auditLogs', auditId), {
    actorUid,
    actorEmail: (ctx.actorEmail || '').slice(0, 200),
    actorRole: (ctx.actorRole || '').slice(0, 40),
    action,
    targetType,
    targetId,
    summary: redactSummary(summary),
    result: 'success',
    createdAt: serverTimestamp(),
  });
}

function nextHistory(
  app: PaidVerificationApplication,
  status: PaidVerificationStatus,
  note: string,
  actorUid: string
): PaidVerificationHistoryEntry[] {
  return [...(app.history || []), { status, note: note.slice(0, 500), actorUid, at: new Date().toISOString() }].slice(-50);
}

async function notifyUser(app: PaidVerificationApplication, actorUid: string, title: string, body: string) {
  await addDoc(collection(db, 'notifications'), {
    recipientId: app.uid,
    actorId: actorUid,
    actorName: 'BANA Verification',
    actorAvatar: '',
    type: 'verification',
    title,
    body,
    linkUrl: '/verification',
    isRead: false,
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

export async function startReview(app: PaidVerificationApplication, actorUid: string, audit: AuditCtx) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'paidVerificationApplications', app.id), {
    status: 'under_review',
    reviewedBy: actorUid,
    history: nextHistory(app, 'under_review', 'Review started.', actorUid),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'verificationStatus', app.uid), {
    uid: app.uid,
    status: 'under_review',
    applicationId: app.id,
    updatedAt: serverTimestamp(),
  });
  stageAudit(batch, `${app.id}_under_review`, actorUid, audit, 'paid_verification_review_started', 'paidVerificationApplication', app.id, `Review started for @${app.username || app.uid}`);
  await batch.commit();
}

export async function approveApplication(app: PaidVerificationApplication, actorUid: string, note: string, audit: AuditCtx) {
  const batch = writeBatch(db);
  batch.update(doc(db, 'paidVerificationApplications', app.id), {
    status: 'verified',
    reviewedBy: actorUid,
    reviewedAt: serverTimestamp(),
    approvedAt: serverTimestamp(),
    adminNote: note.slice(0, 500),
    history: nextHistory(app, 'verified', note || 'Payment confirmed by administrator.', actorUid),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'verificationStatus', app.uid), {
    uid: app.uid,
    status: 'verified',
    applicationId: app.id,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', app.uid), { isVerified: true, verificationType: 'paid', updatedAt: serverTimestamp() });
  stageAudit(
    batch, `${app.id}_verified`, actorUid, audit,
    'paid_verification_approved', 'paidVerificationApplication', app.id,
    `Approved @${app.username || app.uid} (${app.method} ${app.transactionKey.split('__')[1]}, ${app.amount} ${app.currency})`
  );
  await batch.commit();
  await notifyUser(app, actorUid, 'Account Verified', 'Your payment was confirmed and your BANA profile is now verified.');
}

export async function rejectApplication(app: PaidVerificationApplication, actorUid: string, reason: string, audit: AuditCtx) {
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new Error('A rejection reason is required.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'paidVerificationApplications', app.id), {
    status: 'rejected',
    reviewedBy: actorUid,
    reviewedAt: serverTimestamp(),
    rejectionReason: trimmed.slice(0, 500),
    history: nextHistory(app, 'rejected', trimmed, actorUid),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'verificationStatus', app.uid), {
    uid: app.uid,
    status: 'rejected',
    applicationId: app.id,
    updatedAt: serverTimestamp(),
  });
  stageAudit(batch, `${app.id}_rejected`, actorUid, audit, 'paid_verification_rejected', 'paidVerificationApplication', app.id, `Rejected @${app.username || app.uid}: ${trimmed.slice(0, 200)}`);
  await batch.commit();
  await notifyUser(app, actorUid, 'Verification Not Approved', `Your verification payment claim was not approved: ${trimmed}`);
}

export async function revokeVerification(app: PaidVerificationApplication, actorUid: string, reason: string, audit: AuditCtx) {
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new Error('A revocation reason is required.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'paidVerificationApplications', app.id), {
    status: 'revoked',
    revokedBy: actorUid,
    revokedAt: serverTimestamp(),
    revokeReason: trimmed.slice(0, 500),
    history: nextHistory(app, 'revoked', trimmed, actorUid),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(db, 'verificationStatus', app.uid), {
    uid: app.uid,
    status: 'revoked',
    applicationId: app.id,
    updatedAt: serverTimestamp(),
  });
  batch.update(doc(db, 'users', app.uid), { isVerified: false, updatedAt: serverTimestamp() });
  stageAudit(batch, `${app.id}_revoked`, actorUid, audit, 'paid_verification_revoked', 'paidVerificationApplication', app.id, `Revoked @${app.username || app.uid}: ${trimmed.slice(0, 200)}`);
  await batch.commit();
  await notifyUser(app, actorUid, 'Verification Removed', `Your verified status was removed: ${trimmed}`);
}

/**
 * Revoke a profile that has no paid application (e.g. verified through the older document-review flow).
 * Super Admin only (enforced by Firestore Rules). The users update and its audit record are one atomic batch.
 */
export async function revokeProfileOnly(
  uid: string,
  username: string,
  actorUid: string,
  reason: string,
  audit: AuditCtx
) {
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new Error('A revocation reason is required.');
  const auditId = `um_${uid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', uid), {
    isVerified: false,
    lastVerificationAuditId: auditId,
    updatedAt: serverTimestamp(),
  });
  stageAudit(batch, auditId, actorUid, audit, 'verification_manual_revoked', 'user', uid, `Revoked verification for @${username || uid}: ${trimmed.slice(0, 200)}`);
  await batch.commit();
}

/** Super Admin manual grant (non-payment). Atomic with its audit record; rules deny every other role. */
export async function grantVerificationManually(
  uid: string,
  username: string,
  verificationType: 'identity' | 'organization',
  actorUid: string,
  reason: string,
  audit: AuditCtx
) {
  const trimmed = reason.trim();
  if (trimmed.length < 3) throw new Error('A reason is required for a manual verification grant.');
  const auditId = `um_${uid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', uid), {
    isVerified: true,
    verificationType,
    lastVerificationAuditId: auditId,
    updatedAt: serverTimestamp(),
  });
  stageAudit(batch, auditId, actorUid, audit, 'verification_manual_granted', 'user', uid, `Manually verified @${username || uid} (${verificationType}): ${trimmed.slice(0, 200)}`);
  await batch.commit();
}
