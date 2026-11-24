import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, BellRing, Check, CheckCheck, Info, ShieldAlert } from 'lucide-react';
import { AdminCard } from '@/src/components/admin/AdminShared';
import { ADMIN_ALERT_MODULE, type AdminModuleId } from '@/src/lib/adminRbac';
import { isAlertActive, type AdminAlert } from '@/src/lib/adminAlerts';

interface AdminAlertsSectionProps {
  /** Already filtered to what the current staff role is allowed to see. */
  alerts: AdminAlert[];
  acknowledged: Record<string, number>;
  onOpenModule: (mod: AdminModuleId) => void;
  onAcknowledge: (alert: AdminAlert) => Promise<void>;
  onAcknowledgeAll: (alerts: AdminAlert[]) => Promise<void>;
}

const SEVERITY_STYLE: Record<AdminAlert['severity'], { box: string; icon: React.ReactNode; label: string }> = {
  critical: {
    box: 'border-rose-200 dark:border-rose-900 bg-rose-50/70 dark:bg-rose-950/20',
    icon: <ShieldAlert className="w-4 h-4 text-rose-600" />,
    label: 'Critical',
  },
  warning: {
    box: 'border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/20',
    icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
    label: 'Needs action',
  },
  info: {
    box: 'border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950',
    icon: <Info className="w-4 h-4 text-[#1877F2]" />,
    label: 'Info',
  },
};

export function AdminAlertsSection({
  alerts,
  acknowledged,
  onOpenModule,
  onAcknowledge,
  onAcknowledgeAll,
}: AdminAlertsSectionProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [showAcknowledged, setShowAcknowledged] = useState(false);

  const active = alerts.filter((a) => isAlertActive(a, acknowledged));
  const acked = alerts.filter((a) => !isAlertActive(a, acknowledged));
  const visible = showAcknowledged ? alerts : active;

  return (
    <div className="space-y-4">
      <AdminCard className="p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-lg flex items-center gap-2">
              <BellRing className="w-5 h-5 text-[#1877F2]" />
              Administrative Alerts ({active.length} active)
            </h2>
            <p className="text-xs text-neutral-500 max-w-2xl">
              Alerts are computed from live queues and are limited to what your staff role can act on. One alert exists per
              queue, so the same item is never announced twice; an acknowledged alert re-opens only when new items arrive.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
              <input
                type="checkbox"
                checked={showAcknowledged}
                onChange={(e) => setShowAcknowledged(e.target.checked)}
              />
              Show acknowledged ({acked.length})
            </label>
            <button
              type="button"
              disabled={active.length === 0 || busyKey === '__all'}
              onClick={async () => {
                setBusyKey('__all');
                try {
                  await onAcknowledgeAll(active);
                } finally {
                  setBusyKey(null);
                }
              }}
              className="h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-700 font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Acknowledge all
            </button>
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="py-10 text-center text-sm text-neutral-500">
            <Check className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
            All clear — nothing needs your attention right now.
          </div>
        ) : (
          <div className="space-y-2.5">
            {visible.map((alert) => {
              const style = SEVERITY_STYLE[alert.severity];
              const isAcked = !isAlertActive(alert, acknowledged);
              const target = ADMIN_ALERT_MODULE[alert.kind];
              return (
                <div
                  key={alert.key}
                  className={`rounded-xl border p-3.5 flex flex-wrap items-start justify-between gap-3 ${style.box} ${
                    isAcked ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="mt-0.5">{style.icon}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {alert.title}
                        {alert.count > 1 && (
                          <span className="ml-2 font-mono text-[11px] px-1.5 py-0.5 rounded-md bg-white/70 dark:bg-neutral-900">
                            {alert.count}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-neutral-600 dark:text-neutral-400">{alert.detail}</p>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-neutral-400 mt-1">
                        {style.label}
                        {isAcked ? ' · acknowledged' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs shrink-0">
                    <button
                      type="button"
                      onClick={() => onOpenModule(target)}
                      className="inline-flex items-center gap-1 font-semibold text-[#1877F2] hover:underline"
                    >
                      Open <ArrowRight className="w-3 h-3" />
                    </button>
                    {!isAcked && (
                      <button
                        type="button"
                        disabled={busyKey === alert.key}
                        onClick={async () => {
                          setBusyKey(alert.key);
                          try {
                            await onAcknowledge(alert);
                          } finally {
                            setBusyKey(null);
                          }
                        }}
                        className="px-2.5 py-1 rounded-lg border border-neutral-300 dark:border-neutral-700 font-semibold disabled:opacity-50"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </AdminCard>
    </div>
  );
}
