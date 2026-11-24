import React from 'react';
import { BadgeCheck, Sparkles } from 'lucide-react';

export function BanaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none whitespace-nowrap shrink-0">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 font-display font-extrabold text-sm tracking-tight">
        B
      </span>
      {!compact && (
        <span className="font-display font-extrabold text-lg tracking-tight text-neutral-950 dark:text-white">
          BANA
        </span>
      )}
    </span>
  );
}

export function VerifiedBadge({ size = 15 }: { size?: number }) {
  return (
    <span
      title="Verified BANA Account"
      role="img"
      aria-label="Verified account"
      className="inline-flex items-center text-[#1877F2] dark:text-blue-400 shrink-0"
    >
      <BadgeCheck style={{ width: size, height: size }} />
    </span>
  );
}

export function CreatorBadge({ size = 14 }: { size?: number }) {
  return (
    <span title="Approved BANA Creator" className="inline-flex items-center text-amber-600 dark:text-amber-400 shrink-0">
      <Sparkles style={{ width: size, height: size }} />
    </span>
  );
}
