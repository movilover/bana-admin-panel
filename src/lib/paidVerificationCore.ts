// Pure, dependency-free helpers (no Firebase / React) so they can be unit-tested with plain Node.
import {
  PAYMENT_METHOD_IDS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethodId,
  type UserVerificationState,
  type VerificationConfig,
  type VerificationStatusDoc,
} from '../types/paidVerification.ts';

/* ------------------------------------------------------------------ */
/* Pure helpers (no Firebase) — covered by tests/verification/*.mjs     */
/* ------------------------------------------------------------------ */

/** Upper-case, strip whitespace. Rules require ^[A-Z0-9]{6,40}$, so this MUST stay in sync. */
export function normalizeTransactionId(raw: string): string {
  return String(raw || '').replace(/\s+/g, '').toUpperCase();
}

export function buildTransactionKey(method: PaymentMethodId, transactionId: string): string {
  return `${method}__${normalizeTransactionId(transactionId)}`;
}

/** Digits with optional leading +; 10–15 chars. Deliberately loose: Rocket numbers have an extra digit. */
export function normalizeSenderNumber(raw: string): string {
  return String(raw || '').replace(/[\s-]/g, '');
}

export interface SubmissionInput {
  method: PaymentMethodId | '';
  transactionId: string;
  senderNumber: string;
  amount: string | number;
  reference: string;
}

export type SubmissionErrors = Partial<Record<keyof SubmissionInput | 'form', string>>;

export function validateSubmission(input: SubmissionInput, config: VerificationConfig | null): SubmissionErrors {
  const errors: SubmissionErrors = {};
  if (!config || !config.enabled) {
    errors.form = 'Profile verification is currently unavailable.';
    return errors;
  }
  if (!input.method || !PAYMENT_METHOD_IDS.includes(input.method as PaymentMethodId)) {
    errors.method = 'Choose a payment method.';
  } else if (!config.methods[input.method]?.enabled) {
    errors.method = `${PAYMENT_METHOD_LABELS[input.method]} is not currently accepted.`;
  }
  const tx = normalizeTransactionId(input.transactionId);
  if (!/^[A-Z0-9]{6,40}$/.test(tx)) {
    errors.transactionId = 'Enter the transaction ID exactly as shown in your payment confirmation (letters and numbers, 6–40 characters).';
  }
  const sender = normalizeSenderNumber(input.senderNumber);
  if (!/^\+?[0-9]{10,15}$/.test(sender)) {
    errors.senderNumber = 'Enter the mobile number you paid from (10–15 digits).';
  }
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = 'Enter the amount you paid.';
  } else if (amount !== config.feeAmount) {
    // The server (firestore.rules) enforces this too; this is only for a friendlier message.
    errors.amount = `The verification fee is exactly ${formatMoney(config.feeAmount, config.currency)}.`;
  }
  if (input.reference.length > 300) errors.reference = 'Keep the note under 300 characters.';
  return errors;
}

export function formatMoney(amount: number, currency: string): string {
  const n = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  return currency === 'BDT' ? `৳${n}` : `${n} ${currency}`;
}

/** Mask all but the last 3 digits — used where a number is shown in lists. */
export function maskNumber(n: string): string {
  const s = String(n || '');
  return s.length <= 3 ? s : `${'•'.repeat(s.length - 3)}${s.slice(-3)}`;
}

export function resolveUserState(
  statusDoc: VerificationStatusDoc | null,
  isVerifiedOnProfile: boolean
): UserVerificationState {
  // users/{uid}.isVerified is the single source of truth for "Verified".
  if (isVerifiedOnProfile) return 'verified';
  if (!statusDoc) return 'not_verified';
  if (statusDoc.status === 'verified') return 'not_verified'; // profile says otherwise → trust the profile
  if (statusDoc.status === 'revoked') return 'not_verified';
  return statusDoc.status;
}

/** Statuses from which a user may submit a new claim. */
export function canSubmitNewClaim(state: UserVerificationState): boolean {
  return state === 'not_verified' || state === 'rejected';
}

export function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}


export function normalizeConfig(raw: any): VerificationConfig {
  const m = raw?.methods || {};
  const method = (id: PaymentMethodId) => ({
    enabled: m[id]?.enabled === true,
    number: String(m[id]?.number || ''),
    accountType: (['personal', 'agent', 'merchant'].includes(m[id]?.accountType) ? m[id].accountType : 'personal') as
      | 'personal'
      | 'agent'
      | 'merchant',
    instructions: String(m[id]?.instructions || ''),
  });
  return {
    enabled: raw?.enabled === true,
    feeAmount: Number(raw?.feeAmount) > 0 ? Number(raw.feeAmount) : 0,
    currency: String(raw?.currency || 'BDT'),
    generalInstructions: String(raw?.generalInstructions || ''),
    methods: { bkash: method('bkash'), nagad: method('nagad'), rocket: method('rocket') },
    updatedAt: raw?.updatedAt,
    updatedBy: raw?.updatedBy,
  };
}

