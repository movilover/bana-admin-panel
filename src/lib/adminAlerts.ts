import type { AdminAlertKind } from '@/src/lib/adminRbac';

/**
 * Prompt 09 §17 — Administrative alerts.
 *
 * Alerts are DERIVED from live queue sizes (never stored per event), so the same pending
 * item can never produce two notifications. A staff member acknowledges an alert at a given
 * count; it re-opens only when the queue grows beyond what they acknowledged ("new items").
 */
export type AdminAlertSeverity = 'info' | 'warning' | 'critical';

export interface AdminAlert {
  /** Stable key — one alert per queue / service condition. */
  key: string;
  kind: AdminAlertKind;
  severity: AdminAlertSeverity;
  title: string;
  detail: string;
  /** Queue size (0 for boolean service conditions, which use 1 when active). */
  count: number;
}

export interface AdminAlertInputs {
  pendingReports: number;
  pendingMarketplaceReports: number;
  pendingVerifications: number;
  pendingMonetizationApps: number;
  pendingPayoutRequests: number;
  pendingPaymentRequests: number;
  pendingAdCampaigns: number;
  pendingSellerApplications: number;
  marketPaymentsAwaitingVerification: number;
  failedOrUnverifiedAdPayments: number;
  maintenanceMode: boolean;
  registrationOpen: boolean;
  cloudFunctionsExpected: boolean;
  backendConfigured: boolean;
  backendReachable: boolean | null;
}

export function buildAdminAlerts(i: AdminAlertInputs): AdminAlert[] {
  const out: AdminAlert[] = [];
  const queue = (
    key: string,
    kind: AdminAlertKind,
    count: number,
    title: string,
    detail: string,
    severity: AdminAlertSeverity = 'warning'
  ) => {
    if (count > 0) out.push({ key, kind, severity, title, detail, count });
  };

  queue('reports', 'reports', i.pendingReports, 'Pending user & content reports', `${i.pendingReports} report(s) are waiting for a moderator decision.`, i.pendingReports >= 10 ? 'critical' : 'warning');
  queue('marketplace_reports', 'marketplace', i.pendingMarketplaceReports, 'Marketplace reports pending', `${i.pendingMarketplaceReports} product, seller or review report(s) need review.`);
  queue('seller_applications', 'marketplace', i.pendingSellerApplications, 'Seller applications awaiting review', `${i.pendingSellerApplications} seller application(s) are pending.`, 'info');
  queue('market_payments', 'payouts', i.marketPaymentsAwaitingVerification, 'Marketplace payments to verify', `${i.marketPaymentsAwaitingVerification} payment(s) await finance verification.`);
  queue('verifications', 'verifications', i.pendingVerifications, 'Verification applications pending', `${i.pendingVerifications} identity / organization request(s) need a decision.`, 'info');
  queue('monetization', 'monetization', i.pendingMonetizationApps, 'Creator monetization applications', `${i.pendingMonetizationApps} application(s) are pending, appealed or need info.`);
  queue('payout_requests', 'payouts', i.pendingPayoutRequests, 'Creator payout requests', `${i.pendingPayoutRequests} payout request(s) await finance processing.`, i.pendingPayoutRequests >= 5 ? 'critical' : 'warning');
  queue('payment_requests', 'payouts', i.pendingPaymentRequests, 'Boost / slot payment approvals', `${i.pendingPaymentRequests} manual TrxID payment(s) need verification.`);
  queue('ad_payments', 'payouts', i.failedOrUnverifiedAdPayments, 'Ad deposits awaiting verification', `${i.failedOrUnverifiedAdPayments} advertiser deposit(s) are not yet verified.`);
  queue('ad_campaigns', 'ads', i.pendingAdCampaigns, 'Ad campaigns in review', `${i.pendingAdCampaigns} campaign(s) await policy review.`);

  // Service conditions (real configuration / health only)
  if (i.maintenanceMode) {
    out.push({
      key: 'svc_maintenance',
      kind: 'service',
      severity: 'critical',
      title: 'Maintenance mode is ON',
      detail: 'Regular users are currently blocked from the platform until maintenance mode is switched off.',
      count: 1,
    });
  }
  if (!i.registrationOpen) {
    out.push({
      key: 'svc_registration_closed',
      kind: 'service',
      severity: 'info',
      title: 'New registrations are closed',
      detail: 'Registration is disabled in Platform Settings.',
      count: 1,
    });
  }
  if (i.backendConfigured && i.backendReachable === false) {
    out.push({
      key: 'svc_backend_down',
      kind: 'service',
      severity: 'critical',
      title: 'Realtime / calling backend unreachable',
      detail: 'The configured backend did not answer its /health check. Messenger signaling and call tokens may fail.',
      count: 1,
    });
  }
  if (!i.cloudFunctionsExpected) {
    out.push({
      key: 'svc_functions_disabled',
      kind: 'service',
      severity: 'info',
      title: 'Cloud Functions are disabled (Spark mode)',
      detail: 'Privileged finance/moderation actions run through Firestore-rule-enforced client paths. Enable Blaze + Functions for fully server-side authorization.',
      count: 1,
    });
  }
  return out;
}

/** An alert is visible when never acknowledged, or when its queue grew past the acknowledged size. */
export function isAlertActive(alert: AdminAlert, acknowledged: Record<string, number>): boolean {
  const ackCount = acknowledged[alert.key];
  if (typeof ackCount !== 'number') return true;
  return alert.count > ackCount;
}
