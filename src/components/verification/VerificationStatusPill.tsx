import React from 'react';
import { STATUS_LABELS, type UserVerificationState } from '@/src/types/paidVerification';

const TONE: Record<UserVerificationState, string> = {
  not_verified: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300',
  payment_pending: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  under_review: 'bg-blue-50 text-[#1877F2] dark:bg-blue-950/40 dark:text-blue-300',
  verified: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  rejected: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  revoked: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

export function VerificationStatusPill({ state }: { state: UserVerificationState }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${TONE[state]}`}>
      {STATUS_LABELS[state]}
    </span>
  );
}
