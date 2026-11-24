import React, { useMemo, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { addDoc, collection, deleteDoc, doc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import {
  AdminCard,
  AdminKpiTile,
  AdminPagination,
  AdminStateIndicator,
  exportRowsToCsv,
} from '@/src/components/admin/AdminShared';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import { isFunctionsFallbackError, savePolicyWithHistory } from '@/src/lib/monetization';
import type {
  AdCreativeItem,
  AdPaymentRecord,
  AdvertiserAccount,
  AdvertisingSettings,
  BoostPackage,
  FinancialTransaction,
  MarketplacePayment,
  MonetizationPolicy,
  PolicyChangeRecord,
} from '@/src/types/bana';

/* ============================================================================
 * 1. CREATOR MONETIZATION SECTION
 * ========================================================================== */

interface AdminMonetizationSectionProps {
  currentUid: string;
  users: any[];
  applications: any[];
  earnings: any[];
  monetizationPolicy: MonetizationPolicy;
  minWithdrawalUsd: string;
  onSetMinWithdrawalUsd: (v: string) => void;
  canReviewApps: boolean;
  canManageFinance: boolean;
  policyHistory?: PolicyChangeRecord[];
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
  onErrorAction: (msg: string) => void;
  onAskConfirm: (cfg: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    action: () => Promise<void>;
  }) => void;
}

export function AdminMonetizationSection({
  currentUid,
  users,
  applications,
  earnings,
  monetizationPolicy,
  minWithdrawalUsd,
  onSetMinWithdrawalUsd,
  canReviewApps,
  canManageFinance,
  policyHistory = [],
  onWriteAudit,
  onNotifyAction,
  onErrorAction,
  onAskConfirm,
}: AdminMonetizationSectionProps) {
  const [tab, setTab] = useState<'apps' | 'earnings' | 'policy'>('apps');
  const [appFilter, setAppFilter] = useState('all');
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [adjCreatorUid, setAdjCreatorUid] = useState('');
  const [adjAmountUsd, setAdjAmountUsd] = useState('');
  const [adjType, setAdjType] = useState<'confirm' | 'adjustment'>('confirm');
  const [adjSource, setAdjSource] = useState('ad_rev_share');
  const [adjReason, setAdjReason] = useState('');

  const [policyEnabled, setPolicyEnabled] = useState(monetizationPolicy.monetizationEnabled);
  const [creatorShare, setCreatorShare] = useState(String(monetizationPolicy.creatorSharePct));
  const [minFollowers, setMinFollowers] = useState(String(monetizationPolicy.minFollowers));
  const [qualViewSec, setQualViewSec] = useState(String(monetizationPolicy.qualifiedViewMinSeconds));
  const [adPoolCpm, setAdPoolCpm] = useState(String(monetizationPolicy.adPoolCpmUsd ?? 0));
  const [reqEmail, setReqEmail] = useState(monetizationPolicy.requireEmailVerified !== false);
  const [reqOriginal, setReqOriginal] = useState(monetizationPolicy.requireOriginalContent !== false);
  const [reqAdult, setReqAdult] = useState(monetizationPolicy.requireAdultAge !== false);
  const [regionsText, setRegionsText] = useState((monetizationPolicy.eligibleRegions || []).join(', '));
  const [payoutMethodsText, setPayoutMethodsText] = useState((monetizationPolicy.payoutMethodsEnabled || []).join(', '));
  const [policySummary, setPolicySummary] = useState(monetizationPolicy.policySummary || '');
  const [programTerms, setProgramTerms] = useState(monetizationPolicy.programTerms || '');
  const [contentRequirements, setContentRequirements] = useState(monetizationPolicy.contentRequirements || '');
  const [policyReason, setPolicyReason] = useState('');
  const [savingPolicy, setSavingPolicy] = useState(false);

  const handleDecision = async (
    app: any,
    decision: 'approved' | 'rejected' | 'needs_info' | 'suspended' | 'restored'
  ) => {
    const note = (noteById[app.id] || '').trim();
    try {
      await invokeCloudFunction('reviewMonetizationApplication', {
        applicationId: app.id,
        decision,
        adminNote: note,
        rejectionReason: note,
      });
    } catch (err: any) {
      if (!isFunctionsFallbackError(err)) {
        onErrorAction(err.message || 'Review failed');
        return;
      }
      const targetStatus = decision === 'restored' ? 'approved' : decision;
      const prevHist = Array.isArray(app.history) ? app.history : [];
      await updateDoc(doc(db, 'creatorApplications', app.id), {
        status: targetStatus,
        adminNote: note,
        rejectionReason: decision === 'rejected' ? note || 'Policy requirements unmet' : '',
        reviewedBy: currentUid,
        history: [...prevHist, { status: decision, note, actorUid: currentUid, at: new Date().toISOString() }],
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'users', app.uid), {
        isCreator: targetStatus === 'approved',
        updatedAt: serverTimestamp(),
      });
      await setDoc(
        doc(db, 'creatorEligibility', app.uid),
        { uid: app.uid, monetizationStatus: targetStatus, checkedAt: serverTimestamp() },
        { merge: true }
      );
      await onWriteAudit(
        `monetization_${decision}`,
        'creatorApplication',
        app.id,
        `@${app.username} marked ${decision}`
      );
    }
    onNotifyAction(`Monetization application for @${app.username} marked ${decision}.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'apps', label: `Applications (${applications.length})` },
            { id: 'earnings', label: `Creator Earnings Ledger (${earnings.length})` },
            { id: 'policy', label: `Policy & Change History (v${monetizationPolicy.policyVersion || 0})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
              tab === t.id
                ? 'bg-[#1877F2] text-white'
                : 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'apps' && (
        <AdminCard className="p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display font-bold text-lg">Creator Monetization Applications ({applications.length})</h2>
              <p className="text-neutral-500">
                Policy rule: Reaching 1,000+ followers grants eligibility to apply only — monetization never auto-activates without explicit review & approval here.
              </p>
            </div>
            <select
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
              className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
            >
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="needs_info">Needs Info</option>
              <option value="appealed">Appealed</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {applications
              .filter((app) => appFilter === 'all' || app.status === appFilter)
              .map((app) => (
                <div key={app.id} className="py-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-sm">@{app.username}</span>
                        <span className="font-mono text-neutral-500">{app.followerCountAtApply} followers</span>
                        <AdminStateIndicator status={app.status || 'pending'} />
                      </div>
                      <p className="text-neutral-500">
                        Region: {app.country} · Rail: {app.payoutCategory} · {formatRelativeTime(app.createdAt)}
                      </p>
                      {app.appealNote && <p className="text-amber-600 mt-1">Appeal: {app.appealNote}</p>}
                    </div>
                  </div>

                  {canReviewApps && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={noteById[app.id] || ''}
                        onChange={(e) => setNoteById((p) => ({ ...p, [app.id]: e.target.value }))}
                        placeholder="Reviewer note, info request, or rejection reason..."
                        className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleDecision(app, app.status === 'suspended' ? 'restored' : 'approved')}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold"
                        >
                          {app.status === 'suspended' ? 'Restore' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDecision(app, 'needs_info')}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold"
                        >
                          Request Info
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onAskConfirm({
                              title: 'Reject Monetization Application',
                              description: `Reject @${app.username}'s application?`,
                              confirmLabel: 'Reject',
                              variant: 'danger',
                              action: () => handleDecision(app, 'rejected'),
                            })
                          }
                          className="px-3 py-1.5 rounded-lg bg-rose-600 text-white font-semibold"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </AdminCard>
      )}

      {tab === 'earnings' && (
        <div className="space-y-4">
          {canManageFinance && (
            <AdminCard className="p-5">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const amt = Number(adjAmountUsd);
                  if (!adjCreatorUid.trim() || Number.isNaN(amt) || amt === 0 || !adjReason.trim()) {
                    onErrorAction('Creator UID, non-zero USD amount, and audit reason are required.');
                    return;
                  }
                  try {
                    await invokeCloudFunction('adminAdjustOrConfirmCreatorEarnings', {
                      targetUid: adjCreatorUid.trim(),
                      amountUsd: amt,
                      actionType: adjType,
                      sourceType: adjSource,
                      reason: adjReason.trim(),
                    });
                  } catch (err: any) {
                    if (!isFunctionsFallbackError(err)) {
                      onErrorAction(err.message || 'Failed to record adjustment');
                      return;
                    }
                    const rounded = Number(amt.toFixed(2));
                    const earnRef = await addDoc(collection(db, 'creatorEarnings'), {
                      uid: adjCreatorUid.trim(),
                      sourceType: adjType === 'adjustment' ? 'adjustment' : adjSource,
                      amountUsd: rounded,
                      status: adjType === 'adjustment' ? 'adjusted' : 'confirmed',
                      period: new Date().toISOString().slice(0, 7),
                      description: adjReason.trim(),
                      adjustedBy: currentUid,
                      createdAt: serverTimestamp(),
                      updatedAt: serverTimestamp(),
                    });
                    await addDoc(collection(db, 'financialTransactions'), {
                      uid: adjCreatorUid.trim(),
                      txType: adjType === 'adjustment' ? 'earning_adjustment' : 'earning_confirmed',
                      direction: rounded >= 0 ? 'credit' : 'debit',
                      amountUsd: Math.abs(rounded),
                      currency: 'USD',
                      referenceType: 'creatorEarning',
                      referenceId: earnRef.id,
                      description: adjReason.trim(),
                      actorUid: currentUid,
                      createdAt: serverTimestamp(),
                    });
                    await onWriteAudit(
                      `creator_earning_${adjType}`,
                      'creatorEarning',
                      earnRef.id,
                      `Issued $${rounded.toFixed(2)} to ${adjCreatorUid.trim()}`
                    );
                  }
                  setAdjAmountUsd('');
                  setAdjReason('');
                  onNotifyAction('Creator ledger entry recorded.');
                }}
                className="space-y-3 text-xs"
              >
                <h3 className="font-display font-bold text-base">Confirm / Adjust Creator Earnings Ledger</h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <select
                    required
                    value={adjCreatorUid}
                    onChange={(e) => setAdjCreatorUid(e.target.value)}
                    className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                  >
                    <option value="">Select Creator...</option>
                    {users
                      .filter((u) => u.isCreator)
                      .map((u) => (
                        <option key={u.id} value={u.id}>
                          @{u.username} ({u.displayName})
                        </option>
                      ))}
                  </select>
                  <select
                    value={adjType}
                    onChange={(e) => setAdjType(e.target.value as any)}
                    className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                  >
                    <option value="confirm">Confirm Earnings Credit</option>
                    <option value="adjustment">Audited Adjustment (+/-)</option>
                  </select>
                  <select
                    value={adjSource}
                    onChange={(e) => setAdjSource(e.target.value)}
                    className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                  >
                    <option value="ad_rev_share">Ad Revenue Share</option>
                    <option value="video_ads">Video Ads</option>
                    <option value="reels_ads">Reels Ads</option>
                    <option value="platform_program">Platform Bonus</option>
                  </select>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={adjAmountUsd}
                    onChange={(e) => setAdjAmountUsd(e.target.value)}
                    placeholder="Amount USD"
                    className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    required
                    value={adjReason}
                    onChange={(e) => setAdjReason(e.target.value)}
                    placeholder="Mandatory audit reason..."
                    className="flex-1 h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                  />
                  <button type="submit" className="px-4 h-9 rounded-xl bg-[#1877F2] text-white font-semibold shrink-0">
                    Post Ledger Entry
                  </button>
                </div>
              </form>
            </AdminCard>
          )}

          <AdminCard className="p-5 space-y-2 text-xs">
            <h3 className="font-display font-bold text-base">Creator Earnings History ({earnings.length})</h3>
            {earnings.map((e) => (
              <div key={e.id} className="py-2 border-b border-neutral-100 dark:border-neutral-800 flex justify-between gap-2">
                <div>
                  <p className="font-medium">{e.description}</p>
                  <p className="font-mono text-[11px] text-neutral-500">
                    UID: {e.uid} · {e.sourceType} · {e.period}
                  </p>
                </div>
                <span className="font-mono font-bold tabular-nums">
                  ${Number(e.amountUsd || 0).toFixed(2)} · {e.status}
                </span>
              </div>
            ))}
          </AdminCard>
        </div>
      )}

      {tab === 'policy' && (
        <AdminCard className="p-5 space-y-4 text-xs">
          <h2 className="font-display font-bold text-lg">Monetization Eligibility & Split Policy</h2>
          <label className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={policyEnabled}
              onChange={(e) => setPolicyEnabled(e.target.checked)}
              className="accent-[#1877F2]"
            />
            <span>Enable Creator Monetization Program</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block mb-1 font-medium">Creator Share (%)</label>
              <input
                type="number"
                value={creatorShare}
                onChange={(e) => setCreatorShare(e.target.value)}
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 font-medium">Min Followers to Apply</label>
              <input
                type="number"
                value={minFollowers}
                onChange={(e) => setMinFollowers(e.target.value)}
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 font-medium">Min Payout (USD)</label>
              <input
                type="number"
                step="0.5"
                value={minWithdrawalUsd}
                onChange={(e) => onSetMinWithdrawalUsd(e.target.value)}
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 font-medium">Ad Pool CPM (USD)</label>
              <input
                type="number"
                step="0.1"
                value={adPoolCpm}
                onChange={(e) => setAdPoolCpm(e.target.value)}
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={reqEmail} onChange={(e) => setReqEmail(e.target.checked)} className="accent-[#1877F2]" />
              Require verified email
            </label>
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={reqOriginal} onChange={(e) => setReqOriginal(e.target.checked)} className="accent-[#1877F2]" />
              Require original-content attestation
            </label>
            <label className="flex items-center gap-2 font-medium">
              <input type="checkbox" checked={reqAdult} onChange={(e) => setReqAdult(e.target.checked)} className="accent-[#1877F2]" />
              Require adult age (18+)
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block mb-1 font-medium">Eligible regions (country names, comma separated; “Global” or empty = everywhere)</label>
              <input
                value={regionsText}
                onChange={(e) => setRegionsText(e.target.value)}
                placeholder="Bangladesh, India"
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 font-medium">Enabled payout methods (comma separated)</label>
              <input
                value={payoutMethodsText}
                onChange={(e) => setPayoutMethodsText(e.target.value)}
                placeholder="bkash, nagad, bank_transfer"
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
          </div>
          {([
            ['Program summary shown to creators', policySummary, setPolicySummary],
            ['Content requirements', contentRequirements, setContentRequirements],
            ['Program terms (do not promise or guarantee any income)', programTerms, setProgramTerms],
          ] as const).map(([label, value, setter]) => (
            <div key={label}>
              <label className="block mb-1 font-medium">{label}</label>
              <textarea
                rows={3}
                value={value}
                onChange={(e) => setter(e.target.value)}
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3"
              />
            </div>
          ))}
          {canManageFinance ? (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1">
                <label className="block mb-1 font-medium">Reason for this change (required, stored in history)</label>
                <input
                  value={policyReason}
                  onChange={(e) => setPolicyReason(e.target.value)}
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                />
              </div>
              <button
                type="button"
                disabled={savingPolicy}
                onClick={async () => {
                  const share = Math.min(95, Math.max(1, Number(creatorShare) || 55));
                  const csv = (t: string) => t.split(',').map((x) => x.trim()).filter(Boolean);
                  setSavingPolicy(true);
                  try {
                    const version = await savePolicyWithHistory({
                      policyType: 'monetization',
                      collectionName: 'monetizationPolicies',
                      policyId: 'default',
                      before: monetizationPolicy as unknown as Record<string, any>,
                      next: {
                        monetizationEnabled: policyEnabled,
                        creatorSharePct: share,
                        platformSharePct: 100 - share,
                        minFollowers: Math.max(100, Number(minFollowers) || 1000),
                        minPayoutUsd: Math.max(1, Number(minWithdrawalUsd) || 10),
                        qualifiedViewMinSeconds: Math.max(3, Number(qualViewSec) || 5),
                        adPoolCpmUsd: Math.max(0, Number(adPoolCpm) || 0),
                        requireEmailVerified: reqEmail,
                        requireOriginalContent: reqOriginal,
                        requireAdultAge: reqAdult,
                        eligibleRegions: csv(regionsText),
                        payoutMethodsEnabled: csv(payoutMethodsText).map((x) => x.toLowerCase()),
                        policySummary: policySummary.trim(),
                        programTerms: programTerms.trim(),
                        contentRequirements: contentRequirements.trim(),
                      },
                      adminUid: currentUid,
                      reason: policyReason,
                    });
                    if (version === null) {
                      onNotifyAction('No changes to save.');
                    } else {
                      await onWriteAudit('update_monetization_policy', 'monetizationPolicies', 'default', `Policy updated to v${version}: ${policyReason.trim()}`);
                      setPolicyReason('');
                      onNotifyAction(`Monetization policy saved as version ${version}. Past earnings are unchanged.`);
                    }
                  } catch (err: any) {
                    onErrorAction(err?.message || 'Could not save policy.');
                  } finally {
                    setSavingPolicy(false);
                  }
                }}
                className="px-4 h-9 rounded-xl bg-[#1877F2] text-white font-semibold disabled:opacity-50"
              >
                Save Monetization Policy
              </button>
            </div>
          ) : (
            <p className="text-neutral-500">Only Finance / Super Admins can change financial policy.</p>
          )}
          <p className="text-[11px] text-neutral-500">
            Changes apply to future earnings only. Existing earnings and ledger rows are never rewritten, and every
            change is recorded below with a before/after snapshot.
          </p>
          <PolicyHistoryList records={policyHistory.filter((h) => h.policyType === 'monetization')} />
        </AdminCard>
      )}
    </div>
  );
}

/* ============================================================================
 * 2. ADVERTISEMENT MANAGER SECTION
 * ========================================================================== */

interface AdminAdsSectionProps {
  currentUid: string;
  campaigns: any[];
  advertisers: AdvertiserAccount[];
  adCreatives: AdCreativeItem[];
  reports: any[];
  adSettings: AdvertisingSettings;
  onSetAdSettings: React.Dispatch<React.SetStateAction<AdvertisingSettings>>;
  canManageAds: boolean;
  policyHistory?: PolicyChangeRecord[];
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
  onErrorAction: (msg: string) => void;
  onAskConfirm: (cfg: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    action: () => Promise<void>;
  }) => void;
}

export function AdminAdsSection({
  currentUid,
  campaigns,
  advertisers,
  adCreatives,
  reports,
  adSettings,
  onSetAdSettings,
  canManageAds,
  policyHistory = [],
  onWriteAudit,
  onNotifyAction,
  onErrorAction,
  onAskConfirm,
}: AdminAdsSectionProps) {
  const [subTab, setSubTab] = useState<'campaigns' | 'review' | 'advertisers' | 'creatives' | 'reported' | 'settings'>('campaigns');
  const [adPolicyReason, setAdPolicyReason] = useState('');
  const [savingAdPolicy, setSavingAdPolicy] = useState(false);
  const [blockedText, setBlockedText] = useState((adSettings.blockedCategories || []).join(', '));
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const pendingReview = useMemo(() => campaigns.filter((c) => c.status === 'pending_review'), [campaigns]);
  const reportedAds = useMemo(
    () => reports.filter((r) => ['ad', 'adCampaign', 'campaign'].includes(r.targetType)),
    [reports]
  );

  const handleCampDecision = async (c: any, decision: 'active' | 'rejected' | 'paused' | 'terminated') => {
    const reason = (noteById[c.id] || '').trim();
    try {
      await invokeCloudFunction('reviewAdCampaign', {
        campaignId: c.id,
        decision,
        rejectionReason: reason,
      });
    } catch (err: any) {
      if (!isFunctionsFallbackError(err)) {
        onErrorAction(err.message || 'Failed to update campaign');
        return;
      }
      await updateDoc(doc(db, 'adCampaigns', c.id), {
        status: decision,
        rejectionReason: decision === 'rejected' ? reason || 'Violates BANA advertising policy.' : '',
        approvedBy: decision === 'active' ? currentUid : c.approvedBy || '',
        terminatedAt: decision === 'terminated' ? serverTimestamp() : c.terminatedAt || null,
        updatedAt: serverTimestamp(),
      });
      await onWriteAudit(`ad_${decision}`, 'adCampaign', c.id, `${c.campaignName} marked ${decision}`);
    }
    onNotifyAction(`Campaign "${c.campaignName}" updated to ${decision}.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'campaigns', label: `All Campaigns (${campaigns.length})` },
            { id: 'review', label: `Review Queue (${pendingReview.length})` },
            { id: 'advertisers', label: `Advertisers (${advertisers.length})` },
            { id: 'creatives', label: `Creatives (${adCreatives.length})` },
            { id: 'reported', label: `Reported Ads (${reportedAds.length})` },
            { id: 'settings', label: 'Ad Settings & Pricing' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSubTab(t.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
              subTab === t.id
                ? 'bg-[#1877F2] text-white'
                : 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {(subTab === 'campaigns' || subTab === 'review') && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">
            {subTab === 'review' ? 'Ad Campaign Approval Queue' : 'All Advertisement Campaigns'}
          </h2>
          {(subTab === 'review' ? pendingReview : campaigns).map((c) => (
            <div key={c.id} className="py-3 border-b border-neutral-100 dark:border-neutral-800 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{c.campaignName}</span>
                    <AdminStateIndicator status={c.status || 'pending_review'} />
                  </div>
                  <p className="text-neutral-500">
                    {c.headline} · {(c.placements || ['home_feed']).join(', ')} · Budget: ${c.dailyBudgetUsd}/day ($
                    {c.totalBudgetUsd} total) · Spend: ${Number(c.spentUsd || 0).toFixed(2)}
                  </p>
                </div>
                <div className="font-mono text-right tabular-nums">
                  <p>{c.impressions || 0} imp</p>
                  <p>{c.clicks || 0} clicks</p>
                </div>
              </div>
              {canManageAds && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={noteById[c.id] || ''}
                    onChange={(e) => setNoteById((p) => ({ ...p, [c.id]: e.target.value }))}
                    placeholder="Optional policy review note..."
                    className="flex-1 h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleCampDecision(c, 'active')}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => handleCampDecision(c, 'paused')}
                      className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
                    >
                      Pause
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: 'Reject Ad Campaign',
                          description: `Reject "${c.campaignName}"?`,
                          confirmLabel: 'Reject',
                          variant: 'danger',
                          action: () => handleCampDecision(c, 'rejected'),
                        })
                      }
                      className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: 'Terminate Ad Campaign',
                          description: `Permanently terminate "${c.campaignName}"?`,
                          confirmLabel: 'Terminate',
                          variant: 'danger',
                          action: () => handleCampDecision(c, 'terminated'),
                        })
                      }
                      className="px-2.5 py-1 rounded-lg border border-rose-300 text-rose-600 font-semibold"
                    >
                      Terminate
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </AdminCard>
      )}

      {subTab === 'advertisers' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">Advertiser Accounts ({advertisers.length})</h2>
          {advertisers.map((adv) => (
            <div key={adv.uid} className="py-2.5 border-b border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {adv.businessName} · <span className="font-mono">{adv.contactEmail}</span>
                </p>
                <p className="font-mono text-neutral-500 tabular-nums">
                  Wallet: ${Number(adv.walletBalanceUsd || 0).toFixed(2)} · Deposits: $
                  {Number(adv.lifetimeDepositUsd || 0).toFixed(2)} · Spend: ${Number(adv.lifetimeSpendUsd || 0).toFixed(2)}
                </p>
              </div>
              {canManageAds && (
                <div className="flex gap-1.5">
                  {(['active', 'restricted', 'suspended'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={async () => {
                        await updateDoc(doc(db, 'advertisers', adv.uid), {
                          status: st,
                          updatedAt: serverTimestamp(),
                        });
                        await onWriteAudit('advertiser_status', 'advertiser', adv.uid, `Set ${adv.businessName} to ${st}`);
                        onNotifyAction(`Advertiser set to ${st}.`);
                      }}
                      className={`px-2.5 py-1 rounded-lg border capitalize ${
                        adv.status === st
                          ? 'bg-[#1877F2] text-white border-[#1877F2]'
                          : 'border-neutral-200 dark:border-neutral-700'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </AdminCard>
      )}

      {subTab === 'creatives' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">Ad Creatives ({adCreatives.length})</h2>
          {adCreatives.map((cr) => (
            <div key={cr.id} className="py-2.5 border-b border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {cr.title || cr.headline} · <AdminStateIndicator status={cr.approvalStatus || 'pending'} />
                </p>
                <p className="text-neutral-500">{cr.bodyText}</p>
              </div>
              {canManageAds && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      await updateDoc(doc(db, 'adCreatives', cr.id), {
                        approvalStatus: 'approved',
                        updatedAt: serverTimestamp(),
                      });
                      onNotifyAction('Creative approved.');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await updateDoc(doc(db, 'adCreatives', cr.id), {
                        approvalStatus: 'rejected',
                        updatedAt: serverTimestamp(),
                      });
                      onNotifyAction('Creative rejected.');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold"
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </AdminCard>
      )}

      {subTab === 'reported' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">Reported Advertisements ({reportedAds.length})</h2>
          {reportedAds.length === 0 ? (
            <p className="text-neutral-500 py-6 text-center">No reported ads in queue.</p>
          ) : (
            reportedAds.map((r) => (
              <div key={r.id} className="py-2.5 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    {r.reason} · <AdminStateIndicator status={r.status} />
                  </p>
                  <p className="text-neutral-500">{r.details || r.targetId}</p>
                </div>
                {r.status === 'pending' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await updateDoc(doc(db, 'reports', r.id), { status: 'resolved', updatedAt: serverTimestamp() });
                      onNotifyAction('Ad report resolved.');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                  >
                    Resolve
                  </button>
                )}
              </div>
            ))
          )}
        </AdminCard>
      )}

      {subTab === 'settings' && (
        <AdminCard className="p-5 space-y-4 text-xs">
          <h2 className="font-display font-bold text-lg">Ad Delivery & Pricing Policy</h2>
          <label className="flex items-center gap-2 font-semibold">
            <input
              type="checkbox"
              checked={adSettings.adsEnabled}
              onChange={(e) => onSetAdSettings((s) => ({ ...s, adsEnabled: e.target.checked }))}
              className="accent-[#1877F2]"
            />
            <span>Enable Sponsored Ad Delivery Across BANA</span>
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block mb-1 font-medium">Default CPM (USD)</label>
              <input
                type="number"
                step="0.1"
                value={adSettings.defaultCpmUsd}
                onChange={(e) => onSetAdSettings((s) => ({ ...s, defaultCpmUsd: Number(e.target.value) }))}
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 font-medium">Default CPC (USD)</label>
              <input
                type="number"
                step="0.01"
                value={adSettings.defaultCpcUsd}
                onChange={(e) => onSetAdSettings((s) => ({ ...s, defaultCpcUsd: Number(e.target.value) }))}
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 font-medium">Session Freq Cap</label>
              <input
                type="number"
                min={1}
                value={adSettings.frequencyCapPerSession}
                onChange={(e) => onSetAdSettings((s) => ({ ...s, frequencyCapPerSession: Number(e.target.value) }))}
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <div>
              <label className="block mb-1 font-medium">Min Daily Budget (USD)</label>
              <input
                type="number"
                min={1}
                value={adSettings.minDailyBudgetUsd}
                onChange={(e) => onSetAdSettings((s) => ({ ...s, minDailyBudgetUsd: Number(e.target.value) }))}
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block mb-1 font-medium">Min Total Budget (USD)</label>
              <input
                type="number"
                min={1}
                value={adSettings.minTotalBudgetUsd}
                onChange={(e) => onSetAdSettings((st) => ({ ...st, minTotalBudgetUsd: Number(e.target.value) }))}
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block mb-1 font-medium">Blocked ad categories (comma separated)</label>
              <input
                value={blockedText}
                onChange={(e) => {
                  setBlockedText(e.target.value);
                  onSetAdSettings((st) => ({
                    ...st,
                    blockedCategories: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean),
                  }));
                }}
                placeholder="gambling, adult, weapons"
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              />
            </div>
          </div>
          <div>
            <p className="mb-1 font-medium">Active ad placements</p>
            <div className="flex flex-wrap gap-4">
              {([
                ['home_feed', 'Home Feed'],
                ['reels_feed', 'Reels'],
                ['marketplace', 'Marketplace'],
              ] as const).map(([id, label]) => (
                <label key={id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="accent-[#1877F2]"
                    checked={(adSettings.enabledPlacements || []).includes(id)}
                    onChange={(e) =>
                      onSetAdSettings((st) => ({
                        ...st,
                        enabledPlacements: e.target.checked
                          ? Array.from(new Set([...(st.enabledPlacements || []), id]))
                          : (st.enabledPlacements || []).filter((p) => p !== id),
                      }))
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              className="accent-[#1877F2]"
              checked={adSettings.requireManualReview}
              onChange={(e) => onSetAdSettings((st) => ({ ...st, requireManualReview: e.target.checked }))}
            />
            Require manual admin review before any campaign can go live
          </label>
          {canManageAds ? (
            <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
              <div className="flex-1">
                <label className="block mb-1 font-medium">Reason for this change (required, stored in history)</label>
                <input
                  value={adPolicyReason}
                  onChange={(e) => setAdPolicyReason(e.target.value)}
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                />
              </div>
              <button
                type="button"
                disabled={savingAdPolicy}
                onClick={async () => {
                  setSavingAdPolicy(true);
                  try {
                    const { id: _omit, policyVersion: _pv, updatedAt: _ua, updatedBy: _ub, ...rest } = adSettings as any;
                    const version = await savePolicyWithHistory({
                      policyType: 'advertising',
                      collectionName: 'advertisingSettings',
                      policyId: 'default',
                      before: {},
                      next: rest,
                      trackedKeys: [
                        'adsEnabled', 'enabledPlacements', 'blockedCategories', 'defaultCpmUsd', 'defaultCpcUsd',
                        'minDailyBudgetUsd', 'minTotalBudgetUsd', 'frequencyCapPerSession', 'requireManualReview',
                      ],
                      adminUid: currentUid,
                      reason: adPolicyReason,
                    });
                    if (version === null) {
                      onNotifyAction('No changes to save.');
                    } else {
                      await onWriteAudit('update_ad_settings', 'advertisingSettings', 'default', `Ad policy updated to v${version}: ${adPolicyReason.trim()}`);
                      setAdPolicyReason('');
                      onNotifyAction(`Advertising policy saved as version ${version}. Running campaigns keep their approved budgets.`);
                    }
                  } catch (err: any) {
                    onErrorAction(err?.message || 'Could not save ad policy.');
                  } finally {
                    setSavingAdPolicy(false);
                  }
                }}
                className="px-4 h-9 rounded-xl bg-[#1877F2] text-white font-semibold disabled:opacity-50"
              >
                Save Ad Policy
              </button>
            </div>
          ) : (
            <p className="text-neutral-500">You do not have permission to change ad policy.</p>
          )}
          <PolicyHistoryList records={policyHistory.filter((h) => h.policyType === 'advertising')} />
        </AdminCard>
      )}
    </div>
  );
}

/* ============================================================================
 * 3. PAYMENT & FINANCIAL MANAGEMENT SECTION (Super Admin & Finance Manager Only)
 * ========================================================================== */

interface AdminFinanceSectionProps {
  currentUid: string;
  payouts: any[];
  marketPayments: MarketplacePayment[];
  adPayments: AdPaymentRecord[];
  paymentRequests: any[];
  boostPackages: BoostPackage[];
  financialTxs: FinancialTransaction[];
  campaigns: any[];
  earnings: any[];
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
  onErrorAction: (msg: string) => void;
  onAskConfirm: (cfg: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    action: () => Promise<void>;
  }) => void;
}

const TX_PAGE_SIZE = 15;

export function AdminFinanceSection({
  currentUid,
  payouts,
  marketPayments,
  adPayments,
  paymentRequests,
  boostPackages,
  financialTxs,
  campaigns,
  earnings,
  onWriteAudit,
  onNotifyAction,
  onErrorAction,
  onAskConfirm,
}: AdminFinanceSectionProps) {
  const [tab, setTab] = useState<'payouts' | 'market_payments' | 'ad_deposits' | 'boosts' | 'ledger'>('payouts');
  const [payoutRefById, setPayoutRefById] = useState<Record<string, string>>({});
  const [txPage, setTxPage] = useState(1);

  const [pkgName, setPkgName] = useState('');
  const [pkgType, setPkgType] = useState<'boost_post' | 'marketplace_slot'>('boost_post');
  const [pkgPriceBdt, setPkgPriceBdt] = useState('500');
  const [pkgPriceUsd, setPkgPriceUsd] = useState('4.5');
  const [pkgDays, setPkgDays] = useState('7');
  const [pkgReach, setPkgReach] = useState('8000');

  const pagedTxs = useMemo(() => {
    const start = (txPage - 1) * TX_PAGE_SIZE;
    return financialTxs.slice(start, start + TX_PAGE_SIZE);
  }, [financialTxs, txPage]);

  const handlePayout = async (p: any, nextStatus: 'processing' | 'paid' | 'rejected') => {
    const refNote = (payoutRefById[p.id] || '').trim();
    if ((nextStatus === 'paid' || nextStatus === 'rejected') && refNote.length < 3) {
      onErrorAction(nextStatus === 'paid' ? 'Enter the transfer reference ID before marking Paid.' : 'Enter a rejection reason in the note field before rejecting.');
      return;
    }
    try {
      await invokeCloudFunction('processPayoutRequest', {
        payoutId: p.id,
        status: nextStatus,
        transactionRef: nextStatus === 'paid' ? refNote : '',
        adminNote: refNote,
      });
    } catch (err: any) {
      onErrorAction(
        isFunctionsFallbackError(err)
          ? 'Payout processing requires the BANA Cloud Functions backend (state checks, ledger and audit are enforced there). Nothing was changed.'
          : err.message || 'Payout failed'
      );
      return;
    }
    onNotifyAction(`Payout marked ${nextStatus}.`);
  };

  return (
    <div className="space-y-4">
      {/* Financial KPI Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AdminKpiTile
          label="Total Ad Spend"
          value={`$${campaigns.reduce((s, c) => s + Number(c.spentUsd || 0), 0).toFixed(2)}`}
        />
        <AdminKpiTile
          label="Verified Ad Deposits"
          value={`$${adPayments
            .filter((p) => p.status === 'paid')
            .reduce((s, p) => s + Number(p.amountUsd || 0), 0)
            .toFixed(2)}`}
          tone="emerald"
        />
        <AdminKpiTile
          label="Creator Earnings Issued"
          value={`$${earnings.reduce((s, e) => s + Number(e.amountUsd || 0), 0).toFixed(2)}`}
        />
        <AdminKpiTile
          label="Creator Payouts Settled"
          value={`$${payouts
            .filter((p) => p.status === 'paid')
            .reduce((s, p) => s + Number(p.amountUsd || 0), 0)
            .toFixed(2)}`}
          tone="primary"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'payouts', label: `Creator Payouts (${payouts.length})` },
            { id: 'market_payments', label: `Market Payments (${marketPayments.length})` },
            { id: 'ad_deposits', label: `Ad Deposits (${adPayments.length})` },
            { id: 'boosts', label: `Boosts & Packages (${paymentRequests.length})` },
            { id: 'ledger', label: `Immutable Ledger (${financialTxs.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${
              tab === t.id
                ? 'bg-[#1877F2] text-white'
                : 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'payouts' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">Creator Payout Requests ({payouts.length})</h2>
          {payouts.map((p) => (
            <div key={p.id} className="py-3 border-b border-neutral-100 dark:border-neutral-800 space-y-2">
              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm">
                      ${Number(p.amountUsd).toFixed(2)} · {p.method}
                    </span>
                    <AdminStateIndicator status={p.status || 'pending'} />
                  </div>
                  <p className="text-neutral-500">
                    {p.accountHolderName ? `${p.accountHolderName} · ` : ''}
                    {p.accountLabel} · {p.country}
                  </p>
                </div>
                <span className="font-mono text-[11px] text-neutral-500">
                  {p.transactionRef ? `Ref: ${p.transactionRef}` : formatRelativeTime(p.createdAt)}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={payoutRefById[p.id] || ''}
                  onChange={(e) => setPayoutRefById((prev) => ({ ...prev, [p.id]: e.target.value }))}
                  placeholder="Transfer reference ID or rejection note..."
                  className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 font-mono"
                />
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => handlePayout(p, 'processing')}
                    className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700"
                  >
                    Processing
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePayout(p, 'paid')}
                    className="px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold"
                  >
                    Mark Paid
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onAskConfirm({
                        title: 'Reject Payout Request',
                        description: `Reject $${Number(p.amountUsd).toFixed(2)} payout request via ${p.method}?`,
                        confirmLabel: 'Reject Payout',
                        variant: 'danger',
                        action: () => handlePayout(p, 'rejected'),
                      })
                    }
                    className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-semibold"
                  >
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}
        </AdminCard>
      )}

      {tab === 'market_payments' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">Marketplace Order Payments & Refunds ({marketPayments.length})</h2>
          {marketPayments.map((mp) => (
            <div key={mp.id} className="py-3 border-b border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold">
                    Order #{mp.orderId.slice(-8)} · {mp.currency} {mp.amount} · {mp.method}
                  </span>
                  <AdminStateIndicator status={mp.status} />
                </div>
                <p className="text-neutral-500 font-mono">Ref: {mp.transactionRef || 'N/A'}</p>
              </div>
              <div className="flex gap-1.5">
                {mp.status !== 'paid' && (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await invokeCloudFunction('verifyOrRefundMarketplacePayment', {
                          paymentId: mp.id,
                          action: 'mark_paid',
                          note: 'Finance verified transaction',
                        });
                      } catch (fnErr: any) {
                        // Real backend rejections (permission, already-refunded, invalid state) must never be bypassed by a client write.
                        if (!isFunctionsFallbackError(fnErr)) {
                          onErrorAction(fnErr?.message || 'The server rejected this action.');
                          return;
                        }
                        await updateDoc(doc(db, 'payments', mp.id), {
                          status: 'paid',
                          providerVerified: true,
                          reviewedBy: currentUid,
                          updatedAt: serverTimestamp(),
                        });
                        await updateDoc(doc(db, 'orders', mp.orderId), {
                          paymentStatus: 'paid',
                          updatedAt: serverTimestamp(),
                        }).catch(() => {});
                        await onWriteAudit('verify_marketplace_payment', 'payments', mp.id, `Verified ${mp.orderId}`);
                      }
                      onNotifyAction('Payment verified paid.');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                  >
                    Verify Paid
                  </button>
                )}
                {mp.status !== 'refunded' && (
                  <button
                    type="button"
                    onClick={() =>
                      onAskConfirm({
                        title: 'Issue Order Payment Refund',
                        description: `Refund ${mp.currency} ${mp.amount} on order #${mp.orderId.slice(-8)}?`,
                        confirmLabel: 'Issue Refund',
                        variant: 'danger',
                        action: async () => {
                          try {
                            await invokeCloudFunction('adminResolveFinancialRefund', {
                              targetType: 'marketplace_order',
                              targetId: mp.orderId,
                              reason: 'Finance Refund Approved',
                            });
                          } catch (fnErr: any) {
                            // Real backend rejections (permission, already-refunded, invalid state) must never be bypassed by a client write.
                            if (!isFunctionsFallbackError(fnErr)) throw fnErr;
                            await updateDoc(doc(db, 'payments', mp.id), {
                              status: 'refunded',
                              reviewedBy: currentUid,
                              updatedAt: serverTimestamp(),
                            });
                            await updateDoc(doc(db, 'orders', mp.orderId), {
                              paymentStatus: 'refunded',
                              status: 'refunded',
                              updatedAt: serverTimestamp(),
                            }).catch(() => {});
                            await onWriteAudit('refund_marketplace_payment', 'payments', mp.id, `Refunded ${mp.orderId}`);
                          }
                          onNotifyAction('Payment refunded.');
                        },
                      })
                    }
                    className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold"
                  >
                    Issue Refund
                  </button>
                )}
              </div>
            </div>
          ))}
        </AdminCard>
      )}

      {tab === 'ad_deposits' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">Advertiser Billing Deposits ({adPayments.length})</h2>
          {adPayments.map((ap) => (
            <div key={ap.id} className="py-3 border-b border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold">
                    ${Number(ap.amountUsd).toFixed(2)} · {ap.method} · Ref: {ap.transactionRef}
                  </span>
                  <AdminStateIndicator status={ap.status} />
                </div>
                <p className="text-neutral-500 font-mono">Advertiser UID: {ap.advertiserId}</p>
              </div>
              {ap.status !== 'paid' && (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await invokeCloudFunction('reviewAdPayment', { paymentId: ap.id, decision: 'paid' });
                      } catch (fnErr: any) {
                        // Real backend rejections (permission, already-refunded, invalid state) must never be bypassed by a client write.
                        if (!isFunctionsFallbackError(fnErr)) {
                          onErrorAction(fnErr?.message || 'The server rejected this action.');
                          return;
                        }
                        await updateDoc(doc(db, 'adPayments', ap.id), {
                          status: 'paid',
                          providerVerified: true,
                          reviewedBy: currentUid,
                          updatedAt: serverTimestamp(),
                        });
                        await setDoc(
                          doc(db, 'advertisers', ap.advertiserId),
                          {
                            walletBalanceUsd: increment(Number(ap.amountUsd || 0)),
                            lifetimeDepositUsd: increment(Number(ap.amountUsd || 0)),
                            updatedAt: serverTimestamp(),
                          },
                          { merge: true }
                        );
                        await addDoc(collection(db, 'financialTransactions'), {
                          uid: ap.advertiserId,
                          txType: 'ad_deposit',
                          direction: 'credit',
                          amountUsd: Number(ap.amountUsd || 0),
                          currency: 'USD',
                          referenceType: 'adPayment',
                          referenceId: ap.id,
                          description: `Verified ad deposit ($${Number(ap.amountUsd || 0).toFixed(2)})`,
                          actorUid: currentUid,
                          createdAt: serverTimestamp(),
                        });
                        await onWriteAudit('ad_payment_paid', 'adPayment', ap.id, `Credited $${ap.amountUsd}`);
                      }
                      onNotifyAction('Ad deposit verified & credited.');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                  >
                    Verify & Credit
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await updateDoc(doc(db, 'adPayments', ap.id), {
                        status: 'failed',
                        reviewedBy: currentUid,
                        updatedAt: serverTimestamp(),
                      });
                      onNotifyAction('Ad deposit marked failed.');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold"
                  >
                    Fail
                  </button>
                </div>
              )}
            </div>
          ))}
        </AdminCard>
      )}

      {tab === 'boosts' && (
        <div className="space-y-4">
          <AdminCard className="p-5 space-y-3 text-xs">
            <h2 className="font-display font-bold text-lg">Boost & Listing Slot TrxID Approvals ({paymentRequests.length})</h2>
            {paymentRequests.map((req) => (
              <div key={req.id} className="py-2.5 border-b border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">
                      @{req.username} · {req.packageName}
                    </span>
                    <span className="font-mono text-[#1877F2]">
                      ৳{req.amountBdt} / ${req.amountUsd}
                    </span>
                    <AdminStateIndicator status={req.status || 'pending'} />
                  </div>
                  <p className="text-neutral-500 font-mono">
                    {req.paymentMethod} · TrxID: {req.transactionId}
                  </p>
                </div>
                {req.status === 'pending' && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        await updateDoc(doc(db, 'paymentRequests', req.id), {
                          status: 'approved',
                          updatedAt: serverTimestamp(),
                        });
                        if (req.requestType === 'boost_post' && req.targetCollection && req.targetId) {
                          await updateDoc(doc(db, req.targetCollection, req.targetId), {
                            isBoosted: true,
                            boostPackageName: req.packageName,
                            boostReachTarget: req.estimatedReach || 5000,
                          }).catch(() => {});
                        } else if (req.requestType === 'marketplace_slot' && req.uid) {
                          await updateDoc(doc(db, 'users', req.uid), {
                            paidListingQuota: increment(Number(req.listingSlots || 5)),
                          }).catch(() => {});
                        }
                        await onWriteAudit('approve_payment', 'paymentRequests', req.id, `Approved TrxID ${req.transactionId}`);
                        onNotifyAction(`Approved ${req.packageName}.`);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await updateDoc(doc(db, 'paymentRequests', req.id), {
                          status: 'rejected',
                          updatedAt: serverTimestamp(),
                        });
                        await onWriteAudit('reject_payment', 'paymentRequests', req.id, `Rejected TrxID ${req.transactionId}`);
                        onNotifyAction('Payment request rejected.');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </AdminCard>

          <AdminCard className="p-5 space-y-3 text-xs">
            <h3 className="font-display font-bold text-base">Boost & Seller Packages ({boostPackages.length})</h3>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!pkgName.trim()) return;
                const ref = await addDoc(collection(db, 'boostPackages'), {
                  name: pkgName.trim(),
                  packageType: pkgType,
                  priceBdt: Number(pkgPriceBdt) || 500,
                  priceUsd: Number(pkgPriceUsd) || 4.5,
                  durationDays: Number(pkgDays) || 7,
                  estimatedReach: Number(pkgReach) || 5000,
                  isActive: true,
                  createdAt: serverTimestamp(),
                });
                await onWriteAudit('create_boost_package', 'boostPackages', ref.id, `Created ${pkgName.trim()}`);
                setPkgName('');
                onNotifyAction('Package created.');
              }}
              className="grid grid-cols-2 sm:grid-cols-6 gap-2"
            >
              <input
                type="text"
                required
                value={pkgName}
                onChange={(e) => setPkgName(e.target.value)}
                placeholder="Package Name"
                className="col-span-2 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              />
              <select
                value={pkgType}
                onChange={(e) => setPkgType(e.target.value as any)}
                className="h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2"
              >
                <option value="boost_post">Boost</option>
                <option value="marketplace_slot">Market Slots</option>
              </select>
              <input
                type="number"
                value={pkgPriceBdt}
                onChange={(e) => setPkgPriceBdt(e.target.value)}
                placeholder="BDT"
                className="h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2 font-mono"
              />
              <input
                type="number"
                value={pkgReach}
                onChange={(e) => setPkgReach(e.target.value)}
                placeholder="Reach"
                className="h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2 font-mono"
              />
              <button
                type="submit"
                className="h-9 rounded-lg bg-[#1877F2] text-white font-semibold inline-flex items-center justify-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </form>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {boostPackages.map((pkg) => (
                <div key={pkg.id} className="py-2 flex items-center justify-between gap-2">
                  <span>
                    <strong>{pkg.name}</strong> · ৳{pkg.priceBdt} / ${pkg.priceUsd} · {pkg.durationDays}d
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteDoc(doc(db, 'boostPackages', pkg.id));
                      onNotifyAction('Package deleted.');
                    }}
                    className="p-1 text-rose-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </AdminCard>
        </div>
      )}

      {tab === 'ledger' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display font-bold text-lg">Immutable Financial Ledger ({financialTxs.length})</h2>
            <button
              type="button"
              onClick={() =>
                exportRowsToCsv(
                  `bana-financial-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
                  ['ID', 'Type', 'Direction', 'Amount USD', 'UID', 'Description'],
                  financialTxs.map((t) => [t.id, t.txType, t.direction, t.amountUsd, t.uid, t.description])
                )
              }
              className="px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-700 font-semibold inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
          </div>
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {pagedTxs.map((tx) => (
              <div key={tx.id} className="py-2 flex justify-between gap-2">
                <div>
                  <p className="font-medium">{tx.description}</p>
                  <p className="font-mono text-[11px] text-neutral-500">
                    {tx.txType} · UID: {tx.uid} · {formatRelativeTime(tx.createdAt)}
                  </p>
                </div>
                <span className={`font-mono font-bold tabular-nums ${tx.direction === 'credit' ? 'text-emerald-600' : ''}`}>
                  {tx.direction === 'credit' ? '+' : '-'}${Number(tx.amountUsd || 0).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <AdminPagination page={txPage} totalItems={financialTxs.length} pageSize={TX_PAGE_SIZE} onPageChange={setTxPage} />
        </AdminCard>
      )}
    </div>
  );
}


/* Immutable policy change history viewer (Prompt 08) */
export function PolicyHistoryList({ records }: { records: PolicyChangeRecord[] }) {
  if (!records.length) {
    return <p className="text-xs text-neutral-500 pt-2">No policy changes recorded yet.</p>;
  }
  return (
    <div className="space-y-2 pt-2">
      <h3 className="font-display font-bold text-sm">Change history</h3>
      {records.slice(0, 25).map((h) => (
        <details key={h.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-2.5 text-xs">
          <summary className="cursor-pointer font-semibold">
            v{h.version} · {h.changedFields.join(', ')} · {h.reason}
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 font-mono text-[11px]">
            <pre className="whitespace-pre-wrap rounded-lg bg-red-50 dark:bg-red-950/20 p-2">{JSON.stringify(h.before, null, 2)}</pre>
            <pre className="whitespace-pre-wrap rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-2">{JSON.stringify(h.after, null, 2)}</pre>
          </div>
        </details>
      ))}
    </div>
  );
}
