import React from 'react';
import { ArrowRight, ShieldCheck, AlertTriangle } from 'lucide-react';
import { AdminCard, AdminKpiTile, AdminStateIndicator } from '@/src/components/admin/AdminShared';
import { formatCompactNumber, formatRelativeTime } from '@/src/lib/mediaUtils';
import type { AdminModuleId } from '@/src/lib/adminRbac';
import {
  AdminBarChart,
  AdminServiceStatusCard,
  AdminTrendChart,
  type ChartDatum,
} from '@/src/components/admin/AdminDashboardCharts';
import type { PlatformSettings } from '@/src/types/bana';

export interface OverviewCounts {
  totalUsers: number;
  activeUsers: number;
  newRegistrations7d: number;
  totalPosts: number;
  totalReelsAndVideos: number;
  totalCommentsAndReactions: number;
  totalMarketplaceProducts: number;
  totalCommunities: number;
  activeAdvertisements: number;
  monetizationAppsTotal: number;
  pendingMonetizationApps: number;
  pendingReportsTotal: number;
  verifiedRevenueUsd: number;
  marketOrdersTotal: number;
  marketPaidBdt: number;
  approvedCreators: number;
  restrictedAccounts: number;
  totalAdCampaigns: number;
  /** true when headline figures came from exact server-side count queries rather than the loaded sample */
  exactMetrics: boolean;
}

interface AdminOverviewSectionProps {
  counts: OverviewCounts;
  pendingVerifications: number;
  pendingPayouts: number;
  pendingAds: number;
  pendingPaymentRequests: number;
  auditLogs: any[];
  registrationTrend: ChartDatum[];
  contentMix: ChartDatum[];
  platformSettings: PlatformSettings;
  callingEnabled: boolean;
  onBackendHealth?: (reachable: boolean | null) => void;
  canNavigate: (mod: AdminModuleId) => boolean;
  onNavigateModule: (mod: AdminModuleId) => void;
}

export function AdminOverviewSection({
  counts,
  pendingVerifications,
  pendingPayouts,
  pendingAds,
  pendingPaymentRequests,
  auditLogs,
  registrationTrend,
  contentMix,
  platformSettings,
  callingEnabled,
  onBackendHealth,
  canNavigate,
  onNavigateModule,
}: AdminOverviewSectionProps) {
  const navIfAllowed = (mod: AdminModuleId) => (canNavigate(mod) ? () => onNavigateModule(mod) : undefined);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-display font-bold text-xl">Platform Executive Overview</h2>
          <p className="text-xs text-neutral-500">
            Live Firestore aggregates and verified operational queues (zero synthetic or estimated figures).
            {counts.exactMetrics ? ' Headline figures use exact server-side counts.' : ' Some figures are limited to the most recent records loaded.'}
          </p>
        </div>
      </div>

      {/* 12 Required Live Firestore KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <AdminKpiTile
          label="Total Registered Users"
          value={formatCompactNumber(counts.totalUsers)}
          sublabel={`${counts.activeUsers} active standing`}
          onClick={navIfAllowed('users')}
        />
        <AdminKpiTile
          label="Active Users (Standing)"
          value={formatCompactNumber(counts.activeUsers)}
          sublabel="Verified non-suspended accounts"
          tone="emerald"
          onClick={navIfAllowed('users')}
        />
        <AdminKpiTile
          label="New Registrations (7d)"
          value={formatCompactNumber(counts.newRegistrations7d)}
          sublabel="Created in past 7 days"
          tone="primary"
          onClick={navIfAllowed('users')}
        />
        <AdminKpiTile
          label="Total Posts"
          value={formatCompactNumber(counts.totalPosts)}
          sublabel="Feed text, media, polls & voice"
          onClick={navIfAllowed('content')}
        />
        <AdminKpiTile
          label="Total Reels & Videos"
          value={formatCompactNumber(counts.totalReelsAndVideos)}
          sublabel="Short Reels + Video posts"
          onClick={navIfAllowed('content')}
        />
        <AdminKpiTile
          label="Comments & Reactions"
          value={formatCompactNumber(counts.totalCommentsAndReactions)}
          sublabel="Comments, voice notes & likes"
          onClick={navIfAllowed('content')}
        />
        <AdminKpiTile
          label="Marketplace Products"
          value={formatCompactNumber(counts.totalMarketplaceProducts)}
          sublabel={`${counts.marketOrdersTotal} recorded orders`}
          onClick={navIfAllowed('marketplace')}
        />
        <AdminKpiTile
          label="Communities & Groups"
          value={formatCompactNumber(counts.totalCommunities)}
          sublabel="Public & private communities"
          onClick={navIfAllowed('communities')}
        />
        <AdminKpiTile
          label="Active Advertisements"
          value={formatCompactNumber(counts.activeAdvertisements)}
          sublabel={`${pendingAds} awaiting campaign review`}
          tone="primary"
          onClick={navIfAllowed('ads')}
        />
        <AdminKpiTile
          label="Monetization Applications"
          value={formatCompactNumber(counts.monetizationAppsTotal)}
          sublabel={`${counts.pendingMonetizationApps} pending / appealed`}
          tone={counts.pendingMonetizationApps > 0 ? 'amber' : 'default'}
          onClick={navIfAllowed('monetization')}
        />
        <AdminKpiTile
          label="Pending Safety Reports"
          value={formatCompactNumber(counts.pendingReportsTotal)}
          sublabel="Social + Marketplace + Ad queues"
          tone={counts.pendingReportsTotal > 0 ? 'rose' : 'emerald'}
          onClick={navIfAllowed('reports')}
        />
        <AdminKpiTile
          label="Verified Financial Volume"
          value={`$${counts.verifiedRevenueUsd.toFixed(2)}`}
          sublabel={counts.marketPaidBdt > 0 ? `Market: ৳${counts.marketPaidBdt.toLocaleString()}` : 'Ad deposits & verified ledger'}
          tone="emerald"
          onClick={navIfAllowed('finance')}
        />
        <AdminKpiTile
          label="Approved Creators"
          value={formatCompactNumber(counts.approvedCreators)}
          sublabel="Monetization-enabled accounts"
          tone="primary"
          onClick={navIfAllowed('monetization')}
        />
        <AdminKpiTile
          label="Pending Payout Requests"
          value={formatCompactNumber(pendingPayouts)}
          sublabel="Awaiting finance processing"
          tone={pendingPayouts > 0 ? 'amber' : 'default'}
          onClick={navIfAllowed('finance')}
        />
        <AdminKpiTile
          label="Ad Campaigns (All)"
          value={formatCompactNumber(counts.totalAdCampaigns)}
          sublabel={`${counts.activeAdvertisements} active · ${pendingAds} in review`}
          onClick={navIfAllowed('ads')}
        />
        <AdminKpiTile
          label="Suspended / Banned Accounts"
          value={formatCompactNumber(counts.restrictedAccounts)}
          sublabel="Accounts under enforcement"
          tone={counts.restrictedAccounts > 0 ? 'rose' : 'emerald'}
          onClick={navIfAllowed('users')}
        />
      </div>

      {/* Charts & live service status (Prompt 09) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <AdminTrendChart
          title="New Registrations — Last 7 Days"
          subtitle="Exact daily counts from the users collection"
          data={registrationTrend}
          emptyText="No registrations in the last 7 days."
        />
        <AdminBarChart
          title="Platform Content Mix"
          subtitle="Total records per collection"
          data={contentMix}
          emptyText="No platform content recorded yet."
        />
        <AdminServiceStatusCard
          settings={platformSettings}
          callingEnabled={callingEnabled}
          onBackendHealth={onBackendHealth}
        />
      </div>

      {/* Action Queues & Recent Security Audit Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AdminCard className="p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
            <h3 className="font-display font-bold text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Operational Action Queues
            </h3>
            <span className="text-[11px] font-mono text-neutral-500">Live status</span>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
            {[
              {
                label: 'Safety & Moderation Reports',
                count: counts.pendingReportsTotal,
                mod: 'reports' as AdminModuleId,
              },
              {
                label: 'Verification Identity Requests',
                count: pendingVerifications,
                mod: 'verifications' as AdminModuleId,
              },
              {
                label: 'Creator Monetization Reviews',
                count: counts.pendingMonetizationApps,
                mod: 'monetization' as AdminModuleId,
              },
              {
                label: 'Ad Campaign Review Queue',
                count: pendingAds,
                mod: 'ads' as AdminModuleId,
              },
              {
                label: 'Creator Payout Requests',
                count: pendingPayouts,
                mod: 'finance' as AdminModuleId,
              },
              {
                label: 'Boost & Slot TrxID Approvals',
                count: pendingPaymentRequests,
                mod: 'finance' as AdminModuleId,
              },
            ].map((q) => {
              const allowed = canNavigate(q.mod);
              return (
                <div key={q.label} className="py-2.5 flex items-center justify-between gap-3">
                  <span className="font-medium text-neutral-700 dark:text-neutral-300">{q.label}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <AdminStateIndicator
                      status={q.count > 0 ? 'pending' : 'resolved'}
                      label={q.count > 0 ? `${q.count} pending` : 'Clear'}
                    />
                    {allowed && (
                      <button
                        type="button"
                        onClick={() => onNavigateModule(q.mod)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1877F2] hover:underline"
                      >
                        Open <ArrowRight className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </AdminCard>

        <AdminCard className="p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-100 dark:border-neutral-800 pb-3">
            <h3 className="font-display font-bold text-sm flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#1877F2]" />
              Recent Admin & Security Events
            </h3>
            {canNavigate('audit_logs') && (
              <button
                type="button"
                onClick={() => onNavigateModule('audit_logs')}
                className="text-[11px] font-semibold text-[#1877F2] hover:underline"
              >
                View All Logs
              </button>
            )}
          </div>
          {auditLogs.length === 0 ? (
            <p className="text-xs text-neutral-500 py-8 text-center">No audit events recorded yet.</p>
          ) : (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800 text-xs">
              {auditLogs.slice(0, 7).map((log) => (
                <div key={log.id} className="py-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold text-[11px] text-neutral-900 dark:text-neutral-100 truncate">
                      {log.action}
                    </p>
                    <p className="text-neutral-500 truncate">{log.summary}</p>
                  </div>
                  <span className="font-mono text-[10px] text-neutral-400 shrink-0 tabular-nums">
                    {formatRelativeTime(log.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>
    </div>
  );
}
