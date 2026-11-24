import React, { useEffect, useState } from 'react';
import { AdminCard, AdminStateIndicator } from '@/src/components/admin/AdminShared';
import { getBackendBaseUrl } from '@/src/lib/calling/callingProvider';
import { CLOUD_FUNCTIONS_ENABLED, FIREBASE_PLAN_MODE } from '@/src/lib/firebasePlan';
import type { PlatformSettings } from '@/src/types/bana';

export interface ChartDatum {
  label: string;
  value: number;
}

/** Dependency-free SVG bar chart (values come only from real counts passed by the caller). */
export function AdminBarChart({
  title,
  subtitle,
  data,
  emptyText = 'No data recorded yet.',
}: {
  title: string;
  subtitle?: string;
  data: ChartDatum[];
  emptyText?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <AdminCard className="p-5 space-y-3">
      <div>
        <h3 className="font-display font-bold text-sm">{title}</h3>
        {subtitle && <p className="text-[11px] text-neutral-500">{subtitle}</p>}
      </div>
      {total === 0 ? (
        <p className="text-xs text-neutral-500 py-8 text-center">{emptyText}</p>
      ) : (
        <div className="space-y-2" role="img" aria-label={title}>
          {data.map((d) => (
            <div key={d.label} className="flex items-center gap-3 text-[11px]">
              <span className="w-28 shrink-0 truncate text-neutral-600 dark:text-neutral-400">{d.label}</span>
              <div className="flex-1 h-3 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#1877F2]"
                  style={{ width: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }}
                />
              </div>
              <span className="w-14 text-right font-mono tabular-nums">{d.value.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

/** Dependency-free SVG column/trend chart for a short daily series. */
export function AdminTrendChart({
  title,
  subtitle,
  data,
  emptyText = 'No activity recorded in this period.',
}: {
  title: string;
  subtitle?: string;
  data: ChartDatum[];
  emptyText?: string;
}) {
  const width = 320;
  const height = 120;
  const pad = 18;
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;
  const pts = data.map((d, i) => ({
    x: pad + i * step,
    y: height - pad - (d.value / max) * (height - pad * 2),
    ...d,
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = pts.length
    ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${height - pad} L${pts[0].x.toFixed(1)},${height - pad} Z`
    : '';
  return (
    <AdminCard className="p-5 space-y-3">
      <div>
        <h3 className="font-display font-bold text-sm">{title}</h3>
        {subtitle && <p className="text-[11px] text-neutral-500">{subtitle}</p>}
      </div>
      {total === 0 ? (
        <p className="text-xs text-neutral-500 py-8 text-center">{emptyText}</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label={title}>
          <path d={area} className="fill-[#1877F2]/10" />
          <path d={line} fill="none" stroke="#1877F2" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {pts.map((p) => (
            <g key={p.label}>
              <circle cx={p.x} cy={p.y} r={3} fill="#1877F2" />
              <text x={p.x} y={p.y - 7} textAnchor="middle" className="fill-neutral-600 dark:fill-neutral-300" fontSize={8}>
                {p.value}
              </text>
              <text x={p.x} y={height - 4} textAnchor="middle" className="fill-neutral-400" fontSize={8}>
                {p.label}
              </text>
            </g>
          ))}
        </svg>
      )}
    </AdminCard>
  );
}

type BackendHealth = 'not_configured' | 'checking' | 'online' | 'unreachable';

/** Live service/configuration status — every row is derived from real settings or a real /health probe. */
export function AdminServiceStatusCard({
  settings,
  callingEnabled,
  onBackendHealth,
}: {
  settings: PlatformSettings;
  callingEnabled: boolean;
  onBackendHealth?: (reachable: boolean | null) => void;
}) {
  const backendUrl = getBackendBaseUrl();
  const [health, setHealth] = useState<BackendHealth>(backendUrl ? 'checking' : 'not_configured');

  useEffect(() => {
    if (!backendUrl) {
      setHealth('not_configured');
      onBackendHealth?.(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6000);
    setHealth('checking');
    fetch(`${backendUrl}/health`, { signal: controller.signal })
      .then((r) => {
        if (cancelled) return;
        const ok = r.ok;
        setHealth(ok ? 'online' : 'unreachable');
        onBackendHealth?.(ok);
      })
      .catch(() => {
        if (cancelled) return;
        setHealth('unreachable');
        onBackendHealth?.(false);
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl]);

  const flag = (on: boolean | undefined, label?: string) => ({
    status: on === false ? 'suspended' : 'active',
    label: label ?? (on === false ? 'Disabled' : 'Enabled'),
  });

  const rows: Array<{ name: string; status: string; label: string }> = [
    { name: 'Platform', ...(settings.maintenanceMode ? { status: 'suspended', label: 'Maintenance mode' } : { status: 'active', label: 'Live' }) },
    { name: 'New registrations', ...flag(settings.registrationOpen) },
    { name: 'Messenger', ...flag(settings.enableMessaging) },
    { name: 'Audio / video calling', ...flag(settings.enableCalling && callingEnabled) },
    { name: 'Reels', ...flag(settings.enableReels) },
    { name: 'Communities', ...flag(settings.enableCommunities) },
    { name: 'Marketplace', ...flag(settings.enableMarketplace) },
    { name: 'Creator monetization', ...flag(settings.enableMonetization) },
    { name: 'Advertising', ...flag(settings.enableAds) },
    {
      name: `Cloud Functions (${FIREBASE_PLAN_MODE})`,
      ...(CLOUD_FUNCTIONS_ENABLED ? { status: 'active', label: 'Server-side active' } : { status: 'pending', label: 'Disabled (Spark)' }),
    },
    {
      name: 'Realtime / calling backend',
      ...(health === 'online'
        ? { status: 'connected', label: 'Online' }
        : health === 'checking'
        ? { status: 'pending', label: 'Checking…' }
        : health === 'unreachable'
        ? { status: 'failed', label: 'Unreachable' }
        : { status: 'pending', label: 'Not configured' }),
    },
  ];

  return (
    <AdminCard className="p-5 space-y-3">
      <div>
        <h3 className="font-display font-bold text-sm">Platform Service Status</h3>
        <p className="text-[11px] text-neutral-500">
          Read from Platform Settings, build configuration and a live backend /health probe — no simulated uptime.
        </p>
      </div>
      <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
        {rows.map((r) => (
          <div key={r.name} className="py-2 flex items-center justify-between gap-3">
            <span className="text-neutral-700 dark:text-neutral-300">{r.name}</span>
            <AdminStateIndicator status={r.status} label={r.label} />
          </div>
        ))}
      </div>
    </AdminCard>
  );
}
