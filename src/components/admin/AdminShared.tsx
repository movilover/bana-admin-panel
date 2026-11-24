import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export function AdminCard({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function AdminKpiTile({
  label,
  value,
  sublabel,
  tone = 'default',
  onClick,
}: {
  label: string;
  value: string | number;
  sublabel?: string;
  tone?: 'default' | 'primary' | 'emerald' | 'amber' | 'rose';
  onClick?: () => void;
}) {
  const toneClass =
    tone === 'primary'
      ? 'text-[#1877F2]'
      : tone === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : tone === 'amber'
      ? 'text-amber-600 dark:text-amber-400'
      : tone === 'rose'
      ? 'text-rose-600 dark:text-rose-400'
      : 'text-neutral-950 dark:text-white';

  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={`rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 text-left transition-colors ${
        onClick ? 'hover:border-[#1877F2]/60 cursor-pointer' : ''
      }`}
    >
      <p className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400 truncate">{label}</p>
      <p className={`font-mono font-bold text-2xl mt-1 tabular-nums ${toneClass}`}>{value}</p>
      {sublabel && (
        <p className="text-[11px] font-mono text-neutral-500 dark:text-neutral-400 mt-1 truncate tabular-nums">
          {sublabel}
        </p>
      )}
    </Tag>
  );
}

export function AdminStateIndicator({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const s = String(status || 'unknown').toLowerCase();
  const dotColor =
    ['active', 'approved', 'paid', 'published', 'resolved', 'connected', 'ended'].includes(s)
      ? 'bg-emerald-500'
      : ['pending', 'pending_review', 'awaiting_verification', 'processing', 'needs_info', 'appealed', 'pending_cod'].includes(s)
      ? 'bg-amber-500'
      : ['suspended', 'banned', 'rejected', 'removed', 'failed', 'terminated', 'cancelled', 'dismissed', 'refunded', 'restricted'].includes(s)
      ? 'bg-rose-500'
      : 'bg-neutral-400';

  const textColor =
    ['active', 'approved', 'paid', 'published', 'resolved', 'connected', 'ended'].includes(s)
      ? 'text-emerald-700 dark:text-emerald-400'
      : ['pending', 'pending_review', 'awaiting_verification', 'processing', 'needs_info', 'appealed', 'pending_cod'].includes(s)
      ? 'text-amber-700 dark:text-amber-400'
      : ['suspended', 'banned', 'rejected', 'removed', 'failed', 'terminated', 'cancelled', 'dismissed', 'refunded', 'restricted'].includes(s)
      ? 'text-rose-700 dark:text-rose-400'
      : 'text-neutral-600 dark:text-neutral-400';

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold capitalize ${textColor}`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
      <span>{(label || s).replace(/_/g, ' ')}</span>
    </span>
  );
}

export function AdminPagination({
  page,
  totalItems,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (nextPage: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalItems <= pageSize) return null;
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(totalItems, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-neutral-100 dark:border-neutral-800 text-xs text-neutral-500">
      <span className="font-mono tabular-nums">
        Showing {start}–{end} of {totalItems}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 disabled:opacity-40 inline-flex items-center gap-1 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Prev
        </button>
        <span className="font-mono tabular-nums px-2">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 disabled:opacity-40 inline-flex items-center gap-1 hover:bg-neutral-50 dark:hover:bg-neutral-800"
        >
          Next
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function exportRowsToCsv(filename: string, headers: string[], rows: Array<Array<string | number>>) {
  const escape = (val: string | number) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
