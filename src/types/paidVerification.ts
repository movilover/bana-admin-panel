/**
 * Paid Profile Verification — shared types.
 *
 * Collections (all Firestore, see firestore.rules):
 *   verificationConfig/settings          admin-controlled fee, methods, numbers, instructions
 *   paidVerificationApplications/{id}    one document per payment claim (never deleted → full history)
 *   verificationStatus/{uid}             the user's current status pointer (one per user)
 *   paymentClaims/{method__TXNID}        uniqueness lock — a transaction ID can be claimed only once
 *
 * A transaction ID is an UNVERIFIED CLAIM. Nothing here marks a user verified except an
 * authorized administrator's approval (enforced by firestore.rules, not just by the UI).
 */

export const PAYMENT_METHOD_IDS = ['bkash', 'nagad', 'rocket'] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethodId, string> = {
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
};

export type PaidVerificationStatus =
  | 'payment_pending' // user submitted a claim; no admin has looked at it yet
  | 'under_review' // an administrator has picked it up
  | 'verified'
  | 'rejected'
  | 'revoked';

/** What the user sees. "Not Verified" is the absence of an active application. */
export type UserVerificationState = 'not_verified' | PaidVerificationStatus;

export const STATUS_LABELS: Record<UserVerificationState, string> = {
  not_verified: 'Not Verified',
  payment_pending: 'Payment Pending',
  under_review: 'Under Review',
  verified: 'Verified',
  rejected: 'Rejected',
  revoked: 'Revoked',
};

export interface PaymentMethodConfig {
  enabled: boolean;
  number: string;
  accountType: 'personal' | 'agent' | 'merchant';
  instructions: string;
}

export interface VerificationConfig {
  enabled: boolean;
  feeAmount: number;
  currency: string;
  generalInstructions: string;
  methods: Record<PaymentMethodId, PaymentMethodConfig>;
  updatedAt?: any;
  updatedBy?: string;
}

export interface PaidVerificationHistoryEntry {
  status: PaidVerificationStatus;
  note?: string;
  actorUid: string;
  at: string; // ISO string (serverTimestamp() is not allowed inside arrays)
}

export interface PaidVerificationApplication {
  id: string;
  uid: string;
  username?: string;
  displayName?: string;
  method: PaymentMethodId;
  transactionId: string; // normalized: upper-case, [A-Z0-9]
  transactionKey: string; // `${method}__${transactionId}` — also the paymentClaims doc id
  senderNumber: string;
  amount: number; // must equal the configured fee at submission (rules-enforced)
  currency: string;
  reference?: string;
  status: PaidVerificationStatus;
  history: PaidVerificationHistoryEntry[];
  adminNote?: string;
  rejectionReason?: string;
  revokeReason?: string;
  reviewedBy?: string;
  revokedBy?: string;
  reviewedAt?: any;
  approvedAt?: any;
  revokedAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

export interface VerificationStatusDoc {
  uid: string;
  status: PaidVerificationStatus;
  applicationId: string;
  updatedAt?: any;
}
