import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Award,
  Bell,
  BellRing,
  DollarSign,
  FileText,
  Flag,
  HardDrive,
  History,
  LayoutDashboard,
  Megaphone,
  MessageSquare,
  PlugZap,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  ShoppingBag,
  Sliders,
  UserCog,
  Users,
  BarChart3,
} from 'lucide-react';
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { DEFAULT_PLATFORM_SETTINGS, useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  canAccessAdminModule,
  canPerformAdminAction,
  canSeeAdminAlert,
  getAdminRoleLabel,
  type AdminModuleId,
} from '@/src/lib/adminRbac';
import { buildAdminAlerts, isAlertActive, type AdminAlert } from '@/src/lib/adminAlerts';
import { DEFAULT_ADVERTISING_SETTINGS } from '@/src/lib/ads';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { CLOUD_FUNCTIONS_ENABLED, FIREBASE_PLAN_MODE } from '@/src/lib/firebasePlan';
import { getBackendBaseUrl } from '@/src/lib/calling/callingProvider';
import { fetchPaymentGatewayStatus, fetchProductCategories } from '@/src/lib/marketplace';
import { DEFAULT_MONETIZATION_POLICY } from '@/src/lib/monetization';
import { AdminShell } from '@/src/components/layout/AdminShell';
import { ConfirmDialog } from '@/src/components/common/ConfirmDialog';
import { AdminOverviewSection, type OverviewCounts } from '@/src/components/admin/AdminOverviewSection';
import { AdminAlertsSection } from '@/src/components/admin/AdminAlertsSection';
import { AdminUsersSection } from '@/src/components/admin/AdminUsersSection';
import { AdminVerificationsSection } from '@/src/components/admin/AdminVerificationsSection';
import { AdminPaidVerificationSection } from '@/src/components/admin/AdminPaidVerificationSection';
import { AdminFriendSuggestionsSection } from '@/src/components/admin/AdminFriendSuggestionsSection';
import { AdminSmartVideoSection } from '@/src/components/admin/AdminSmartVideoSection';
import { AdminContentSection } from '@/src/components/admin/AdminContentSection';
import { AdminMessengerCallingSection } from '@/src/components/admin/AdminMessengerCallingSection';
import { AdminCommunitiesSection, AdminMarketplaceSection } from '@/src/components/admin/AdminMarketCommunitySection';
import {
  AdminAdsSection,
  AdminFinanceSection,
  AdminMonetizationSection,
} from '@/src/components/admin/AdminMonetizationAdsFinanceSection';
import { AdminReportsSection } from '@/src/components/admin/AdminReportsSection';
import { AdminPlatformSettingsSection } from '@/src/components/admin/AdminPlatformSettingsSection';
import { AdminRbacSection } from '@/src/components/admin/AdminRbacSection';
import { AdminAuditLogsSection, AdminNotificationsSection } from '@/src/components/admin/AdminLogsNotificationsSection';
import { AdminStorageRecoverySection } from '@/src/components/admin/AdminStorageRecoverySection';
import { AdminApiManagementSection } from '@/src/components/admin/AdminApiManagementSection';
import {
  DEFAULT_PRODUCT_CATEGORIES,
  type AdCreativeItem,
  type AdPaymentRecord,
  type AdvertiserAccount,
  type AdvertisingSettings,
  type BanaEvent,
  type BanaStore,
  type BoostPackage,
  type FinancialTransaction,
  type MarketplaceOrder,
  type MarketplacePayment,
  type MarketplacePolicySettings,
  type MarketplaceReport,
  type SellerApplication,
  type ProductReview,
  type PolicyChangeRecord,
  type MonetizationPolicy,
  type PaymentGatewayStatus,
  type PlatformSettings,
  type ProductCategoryItem,
} from '@/src/types/bana';

const DEFAULT_MARKET_POLICY: MarketplacePolicySettings = {
  id: 'marketplace',
  requireListingApproval: false,
  freeListingsLimit: 5,
  requireSellerVerificationForStores: false,
  allowedCurrencies: ['BDT', 'USD'],
  buyerDisputeWindowDays: 7,
  escrowHoldDays: 3,
  policySummary: 'All marketplace sellers must represent items accurately and honor verified buyer refunds.',
};

interface NavItem {
  id: AdminModuleId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: string;
}

// Grouped for a clear section hierarchy (Prompt 09 §18). Visibility is still decided by RBAC.
const ADMIN_NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, group: 'Command Center' },
  { id: 'alerts', label: 'Alerts', icon: BellRing, group: 'Command Center' },
  { id: 'users', label: 'Users', icon: Users, group: 'People & Safety' },
  { id: 'verifications', label: 'Verifications', icon: ShieldCheck, group: 'People & Safety' },
  { id: 'paid_verifications', label: 'Paid Verification', icon: ShieldCheck, group: 'People & Safety' },
  { id: 'friend_suggestions', label: 'Friend Suggestions', icon: Users, group: 'People & Safety' },
  { id: 'smart_video', label: 'Smart Video Distribution', icon: BarChart3, group: 'People & Safety' },
  { id: 'content', label: 'Content & Reels', icon: FileText, group: 'People & Safety' },
  { id: 'communities', label: 'Communities', icon: Users, group: 'People & Safety' },
  { id: 'reports', label: 'Reports & Safety', icon: Flag, group: 'People & Safety' },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag, group: 'Commerce & Money' },
  { id: 'monetization', label: 'Monetization', icon: Award, group: 'Commerce & Money' },
  { id: 'ads', label: 'Ads Manager', icon: Megaphone, group: 'Commerce & Money' },
  { id: 'finance', label: 'Finance & Payouts', icon: DollarSign, group: 'Commerce & Money' },
  { id: 'messenger_calling', label: 'Messenger & Calling', icon: MessageSquare, group: 'Platform & Services' },
  { id: 'api_management', label: 'API & Providers', icon: PlugZap, group: 'Platform & Services' },
  { id: 'storage_recovery', label: 'Storage & Recovery', icon: HardDrive, group: 'Platform & Services' },
  { id: 'platform_settings', label: 'Platform Settings', icon: Sliders, group: 'Platform & Services' },
  { id: 'notifications', label: 'User Notices', icon: Bell, group: 'Platform & Services' },
  { id: 'admin_roles', label: 'Staff & RBAC', icon: UserCog, group: 'Administration' },
  { id: 'audit_logs', label: 'Audit Logs', icon: History, group: 'Administration' },
];

interface ConfirmActionState {
  title: string;
  description: string;
  confirmLabel: string;
  variant?: 'danger' | 'primary';
  action: () => Promise<void>;
}

function toEpochMs(val: any): number {
  if (!val) return 0;
  if (typeof val === 'number') return val;
  if (typeof val?.toMillis === 'function') return val.toMillis();
  if (val?.seconds) return Number(val.seconds) * 1000;
  const parsed = Date.parse(String(val));
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function AdminPage() {
  const { firebaseUser, profile, adminRole, claimsAdminRole, platformSettings } = useAuth();
  const toast = useToast();

  const [activeMod, setActiveMod] = useState<AdminModuleId>('overview');
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [userSearchInitial, setUserSearchInitial] = useState('');

  // Collections
  const [users, setUsers] = useState<any[]>([]);
  const [userEmailsByUid, setUserEmailsByUid] = useState<Record<string, string>>({});
  const [posts, setPosts] = useState<any[]>([]);
  const [reels, setReels] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [voiceComments, setVoiceComments] = useState<any[]>([]);
  const [listings, setListings] = useState<any[]>([]);
  const [communities, setCommunities] = useState<any[]>([]);
  const [reports, setReports] = useState<any[]>([]);
  const [applications, setApplications] = useState<any[]>([]);
  const [earnings, setEarnings] = useState<any[]>([]);
  const [payouts, setPayouts] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [adminRolesList, setAdminRolesList] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [boostPackages, setBoostPackages] = useState<BoostPackage[]>([]);
  const [paymentRequests, setPaymentRequests] = useState<any[]>([]);
  const [verificationRequests, setVerificationRequests] = useState<any[]>([]);
  const [callsLog, setCallsLog] = useState<any[]>([]);
  const [stores, setStores] = useState<BanaStore[]>([]);
  const [marketOrders, setMarketOrders] = useState<MarketplaceOrder[]>([]);
  const [marketPayments, setMarketPayments] = useState<MarketplacePayment[]>([]);
  const [marketReports, setMarketReports] = useState<MarketplaceReport[]>([]);
  const [sellerApplications, setSellerApplications] = useState<SellerApplication[]>([]);
  const [productReviewDocs, setProductReviewDocs] = useState<ProductReview[]>([]);
  const [policyHistory, setPolicyHistory] = useState<PolicyChangeRecord[]>([]);
  const [communityEvents, setCommunityEvents] = useState<BanaEvent[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategoryItem[]>(DEFAULT_PRODUCT_CATEGORIES);
  const [gatewayStatus, setGatewayStatus] = useState<PaymentGatewayStatus | null>(null);
  const [gwCodEnabled, setGwCodEnabled] = useState(true);
  const [gwManualMobileEnabled, setGwManualMobileEnabled] = useState(true);

  const [advertisers, setAdvertisers] = useState<AdvertiserAccount[]>([]);
  const [adCreatives, setAdCreatives] = useState<AdCreativeItem[]>([]);
  const [adPayments, setAdPayments] = useState<AdPaymentRecord[]>([]);
  const [financialTxs, setFinancialTxs] = useState<FinancialTransaction[]>([]);
  const [monetizationPolicy, setMonetizationPolicy] = useState<MonetizationPolicy>(DEFAULT_MONETIZATION_POLICY);
  const [adSettings, setAdSettings] = useState<AdvertisingSettings>(DEFAULT_ADVERTISING_SETTINGS);
  const [minWithdrawalUsd, setMinWithdrawalUsd] = useState('10');

  const [platFormSettings, setPlatFormSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM_SETTINGS);
  const [marketPolicy, setMarketPolicy] = useState<MarketplacePolicySettings>(DEFAULT_MARKET_POLICY);

  const [callingSettings, setCallingSettings] = useState({
    webrtcEnabled: true,
    allowVoiceCalls: true,
    allowVideoCalls: true,
    allowGroupCalls: true,
    allowScreenSharing: true,
    maxGroupCallParticipants: 8,
    activeCallingProvider: 'webrtc_builtin',
    stunServers: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
    turnRelayHint: '',
    turnProvider: 'none' as 'none' | 'coturn' | 'metered' | 'twilio',
    maxCallDurationMinutes: 60,
  });

  // Exact collection counts
  const [exactCounts, setExactCounts] = useState<{
    users?: number;
    posts?: number;
    reels?: number;
    comments?: number;
    voiceComments?: number;
    products?: number;
    communities?: number;
  }>({});

  // Exact server-side aggregates (count queries). `undefined` means the role may not read that collection.
  const [exactStats, setExactStats] = useState<{
    activeUsers?: number;
    restrictedUsers?: number;
    approvedCreators?: number;
    registrationsByDay?: Array<{ label: string; value: number }>;
    pendingReports?: number;
    pendingMarketReports?: number;
    pendingVerifications?: number;
    pendingMonetization?: number;
    pendingPayouts?: number;
    pendingAdCampaigns?: number;
    activeAdCampaigns?: number;
    totalAdCampaigns?: number;
    pendingSellerApps?: number;
  }>({});
  const [alertAck, setAlertAck] = useState<Record<string, number>>({});
  const [backendReachable, setBackendReachable] = useState<boolean | null>(null);

  // Confirm Dialog
  const [confirmState, setConfirmState] = useState<ConfirmActionState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const visibleNavItems = useMemo(
    () => ADMIN_NAV_ITEMS.filter((item) => canAccessAdminModule(adminRole, item.id)),
    [adminRole]
  );

  // Ensure activeMod is always accessible by current role
  useEffect(() => {
    if (adminRole && !canAccessAdminModule(adminRole, activeMod)) {
      setActiveMod(visibleNavItems[0]?.id || 'overview');
    }
  }, [adminRole, activeMod, visibleNavItems]);

  /**
   * Append-only audit entry. Never stores passwords/tokens; summary is length-capped and redacted.
   * A failed audit write is surfaced to the operator instead of being silently swallowed.
   */
  const writeAudit = useCallback(
    async (
      action: string,
      targetType: string,
      targetId: string,
      summary: string,
      result: 'success' | 'failure' | 'denied' = 'success'
    ): Promise<void> => {
      if (!firebaseUser) return;
      const safeSummary = String(summary || '')
        .replace(/(password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
        .slice(0, 500);
      try {
        await addDoc(collection(db, 'auditLogs'), {
          actorUid: firebaseUser.uid,
          actorEmail: (firebaseUser.email || '').slice(0, 200),
          actorRole: adminRole || '',
          action: String(action).slice(0, 80),
          targetType: String(targetType).slice(0, 60),
          targetId: String(targetId).slice(0, 200),
          summary: safeSummary,
          result,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        logFirestoreError(err, OperationType.CREATE, 'auditLogs');
        toast.error('Audit log entry could not be saved. The action itself may have completed — please verify and report this.');
      }
    },
    [firebaseUser, adminRole, toast]
  );

  // Log session-deduplicated admin_login event once per browser session
  useEffect(() => {
    if (!firebaseUser || !adminRole) return;
    const key = `bana_admin_login_logged_${firebaseUser.uid}`;
    try {
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        void writeAudit(
          'admin_login',
          'adminSession',
          firebaseUser.uid,
          `Opened Super Admin Control Panel (${adminRole})`
        );
      }
    } catch {
      // sessionStorage may be unavailable in restricted contexts
    }
  }, [firebaseUser, adminRole, writeAudit]);

  const loadAll = useCallback(async () => {
    if (!firebaseUser || !adminRole) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const safeFetch = async (colName: string, orderField = 'createdAt', maxRows = 150) => {
        try {
          const s = await getDocs(query(collection(db, colName), orderBy(orderField, 'desc'), limit(maxRows)));
          return s.docs.map((d) => ({ id: d.id, ...d.data() }));
        } catch {
          try {
            const s = await getDocs(query(collection(db, colName), limit(maxRows)));
            return s.docs.map((d) => ({ id: d.id, ...d.data() }));
          } catch {
            return [];
          }
        }
      };

      const safeCount = async (colName: string): Promise<number | undefined> => {
        try {
          const snap = await getCountFromServer(collection(db, colName));
          return snap.data().count;
        } catch {
          return undefined;
        }
      };

      const [
        u,
        userSettDocs,
        p,
        r,
        st,
        c,
        vc,
        l,
        com,
        rep,
        app,
        earn,
        pay,
        ad,
        roles,
        logs,
        pkgs,
        payReqs,
        verifReqs,
        callDocs,
        storesDocs,
        orderDocs,
        payDocs,
        mktRepDocs,
        evDocs,
        prodCats,
        gwStatusObj,
        monSett,
        gwSett,
        platSett,
        mktPolSnap,
        callSett,
        advDocs,
        creativeDocs,
        adPayDocs,
        finTxDocs,
        monPolSnap,
        adSettSnap,
        cntUsers,
        cntPosts,
        cntReels,
        cntComments,
        cntVoice,
        cntProducts,
        cntCommunities,
      ] = await Promise.all([
        safeFetch('users', 'createdAt', 80),
        safeFetch('userSettings', 'updatedAt', 80),
        safeFetch('posts', 'createdAt', 60),
        safeFetch('reels', 'createdAt', 60),
        safeFetch('stories', 'createdAt', 40),
        safeFetch('comments', 'createdAt', 60),
        safeFetch('voiceComments', 'createdAt', 40),
        safeFetch('marketplaceListings', 'createdAt', 60),
        safeFetch('communities', 'createdAt', 60),
        safeFetch('reports', 'createdAt', 60),
        safeFetch('creatorApplications', 'createdAt', 60),
        safeFetch('creatorEarnings', 'createdAt', 60),
        safeFetch('payoutRequests', 'createdAt', 60),
        safeFetch('adCampaigns', 'createdAt', 60),
        safeFetch('adminRoles', 'createdAt', 50),
        safeFetch('auditLogs', 'createdAt', 80),
        safeFetch('boostPackages', 'createdAt', 30),
        safeFetch('paymentRequests', 'createdAt', 60),
        safeFetch('verificationRequests', 'createdAt', 60),
        safeFetch('calls', 'createdAt', 60),
        safeFetch('stores', 'createdAt', 50),
        safeFetch('orders', 'createdAt', 60),
        safeFetch('payments', 'createdAt', 60),
        safeFetch('marketplaceReports', 'createdAt', 60),
        safeFetch('events', 'createdAt', 50),
        fetchProductCategories(true).catch(() => DEFAULT_PRODUCT_CATEGORIES),
        fetchPaymentGatewayStatus().catch(() => null),
        getDoc(doc(db, 'adminSettings', 'monetization')).catch(() => null),
        getDoc(doc(db, 'adminSettings', 'paymentGateways')).catch(() => null),
        getDoc(doc(db, 'adminSettings', 'platform')).catch(() => null),
        getDoc(doc(db, 'adminSettings', 'marketplace')).catch(() => null),
        getDoc(doc(db, 'adminSettings', 'calling')).catch(() => null),
        safeFetch('advertisers', 'updatedAt', 50),
        safeFetch('adCreatives', 'createdAt', 50),
        safeFetch('adPayments', 'createdAt', 50),
        safeFetch('financialTransactions', 'createdAt', 80),
        getDoc(doc(db, 'monetizationPolicies', 'default')).catch(() => null),
        getDoc(doc(db, 'advertisingSettings', 'default')).catch(() => null),
        safeCount('users'),
        safeCount('posts'),
        safeCount('reels'),
        safeCount('comments'),
        safeCount('voiceComments'),
        safeCount('marketplaceListings'),
        safeCount('communities'),
      ]);

      const emailsMap: Record<string, string> = {};
      userSettDocs.forEach((us: any) => {
        if (us.email) emailsMap[us.id] = String(us.email);
      });
      setUserEmailsByUid(emailsMap);

      // Merge private account fields (moderation note, messaging restriction, isMinor) from userPrivate (admin-readable).
      let usersMerged = u;
      try {
        const ps = await getDocs(query(collection(db, 'userPrivate'), limit(500)));
        const pm = new Map(ps.docs.map((d) => [d.id, d.data() as Record<string, any>]));
        usersMerged = u.map((x: any) => {
          const pv = pm.get(x.id);
          return pv
            ? {
                ...x,
                isMinor: pv.isMinor ?? x.isMinor,
                accountRestrictionNote: pv.accountRestrictionNote ?? x.accountRestrictionNote,
                messagingRestricted: pv.messagingRestricted ?? x.messagingRestricted,
              }
            : x;
        });
      } catch {
        /* legacy public values remain as fallback */
      }
      setUsers(usersMerged);
      setPosts(p);
      setReels(r);
      setStories(st);
      setComments(c);
      setVoiceComments(vc);
      setListings(l);
      setCommunities(com);
      setReports(rep);
      setApplications(app);
      setEarnings(earn);
      setPayouts(pay);
      setCampaigns(ad);
      setAdminRolesList(roles);
      setAuditLogs(logs);
      setBoostPackages(pkgs as BoostPackage[]);
      setPaymentRequests(payReqs);
      setVerificationRequests(verifReqs);
      setCallsLog(callDocs);
      setStores(storesDocs as BanaStore[]);
      setMarketOrders(orderDocs as MarketplaceOrder[]);
      setMarketPayments(payDocs as MarketplacePayment[]);
      setMarketReports(mktRepDocs as MarketplaceReport[]);
      setCommunityEvents(evDocs as BanaEvent[]);
      setProductCategories(prodCats);
      if (gwStatusObj) setGatewayStatus(gwStatusObj);
      setAdvertisers(advDocs as unknown as AdvertiserAccount[]);
      setAdCreatives(creativeDocs as unknown as AdCreativeItem[]);
      setAdPayments(adPayDocs as unknown as AdPaymentRecord[]);
      setFinancialTxs(finTxDocs as unknown as FinancialTransaction[]);

      // Prompt 09: exact server-side aggregates + this staff member's acknowledged alerts.
      // Each count is independent: a role without read access to a collection simply yields `undefined`
      // and the dashboard falls back to the loaded sample for that single figure.
      const countWhere = async (colName: string, ...constraints: QueryConstraint[]): Promise<number | undefined> => {
        try {
          const snap = await getCountFromServer(query(collection(db, colName), ...constraints));
          return snap.data().count;
        } catch {
          return undefined;
        }
      };
      const dayWindows = Array.from({ length: 7 }, (_, i) => {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        start.setDate(start.getDate() - (6 - i));
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return { start, end, label: start.toLocaleDateString(undefined, { weekday: 'short' }) };
      });
      const [
        xActive,
        xRestricted,
        xCreators,
        xPendReports,
        xPendMarketReports,
        xPendVerif,
        xPendMon,
        xPendPayouts,
        xPendAds,
        xActiveAds,
        xTotalAds,
        xPendSellerApps,
        xDays,
        ackSnap,
      ] = await Promise.all([
        countWhere('users', where('accountStatus', '==', 'active')),
        countWhere('users', where('accountStatus', 'in', ['suspended', 'banned'])),
        countWhere('users', where('isCreator', '==', true)),
        countWhere('reports', where('status', '==', 'pending')),
        countWhere('marketplaceReports', where('status', '==', 'pending')),
        countWhere('verificationRequests', where('status', 'in', ['pending', 'needs_info'])),
        countWhere('creatorApplications', where('status', 'in', ['pending', 'appealed', 'needs_info'])),
        countWhere('payoutRequests', where('status', '==', 'pending')),
        countWhere('adCampaigns', where('status', '==', 'pending_review')),
        countWhere('adCampaigns', where('status', '==', 'active')),
        safeCount('adCampaigns'),
        countWhere('sellerApplications', where('status', '==', 'pending')),
        Promise.all(
          dayWindows.map((w) =>
            countWhere(
              'users',
              where('createdAt', '>=', Timestamp.fromDate(w.start)),
              where('createdAt', '<', Timestamp.fromDate(w.end))
            )
          )
        ),
        getDoc(doc(db, 'adminAlertState', firebaseUser.uid)).catch(() => null),
      ]);
      setExactStats({
        activeUsers: xActive,
        restrictedUsers: xRestricted,
        approvedCreators: xCreators,
        pendingReports: xPendReports,
        pendingMarketReports: xPendMarketReports,
        pendingVerifications: xPendVerif,
        pendingMonetization: xPendMon,
        pendingPayouts: xPendPayouts,
        pendingAdCampaigns: xPendAds,
        activeAdCampaigns: xActiveAds,
        totalAdCampaigns: xTotalAds,
        pendingSellerApps: xPendSellerApps,
        registrationsByDay: xDays.every((n) => typeof n === 'number')
          ? dayWindows.map((w, i) => ({ label: w.label, value: xDays[i] as number }))
          : undefined,
      });
      const ackRaw = ackSnap && 'exists' in ackSnap && ackSnap.exists() ? (ackSnap.data()?.acknowledged as Record<string, unknown>) : {};
      const ackClean: Record<string, number> = {};
      Object.entries(ackRaw || {}).forEach(([k, v]) => {
        if (typeof v === 'number') ackClean[k] = v;
      });
      setAlertAck(ackClean);

      // Prompt 07/08 extras (kept outside the positional Promise.all above)
      const [sellerAppDocs, reviewDocs, policyHistDocs] = await Promise.all([
        safeFetch('sellerApplications', 'createdAt', 80),
        safeFetch('productReviews', 'createdAt', 80),
        safeFetch('policyChangeHistory', 'createdAt', 80),
      ]);
      setSellerApplications(sellerAppDocs as unknown as SellerApplication[]);
      setProductReviewDocs(reviewDocs as unknown as ProductReview[]);
      setPolicyHistory(policyHistDocs as unknown as PolicyChangeRecord[]);

      setExactCounts({
        users: cntUsers,
        posts: cntPosts,
        reels: cntReels,
        comments: cntComments,
        voiceComments: cntVoice,
        products: cntProducts,
        communities: cntCommunities,
      });

      if (monPolSnap?.exists()) {
        const mp = monPolSnap.data() as MonetizationPolicy;
        setMonetizationPolicy({ ...DEFAULT_MONETIZATION_POLICY, ...mp, id: 'default' });
        if (mp.minPayoutUsd) setMinWithdrawalUsd(String(mp.minPayoutUsd));
      } else if (monSett?.exists() && monSett.data()?.minWithdrawalUsd) {
        setMinWithdrawalUsd(String(monSett.data()?.minWithdrawalUsd));
      }

      if (adSettSnap?.exists()) {
        setAdSettings({ ...DEFAULT_ADVERTISING_SETTINGS, ...(adSettSnap.data() as Partial<AdvertisingSettings>) });
      }
      if (gwSett?.exists()) {
        const g = gwSett.data()!;
        setGwCodEnabled(g.codEnabled !== false);
        setGwManualMobileEnabled(g.manualMobileBankingEnabled !== false);
      }
      if (platSett?.exists()) {
        setPlatFormSettings({ ...DEFAULT_PLATFORM_SETTINGS, ...(platSett.data() as Partial<PlatformSettings>) });
      } else {
        setPlatFormSettings(platformSettings);
      }
      if (mktPolSnap?.exists()) {
        setMarketPolicy({ ...DEFAULT_MARKET_POLICY, ...(mktPolSnap.data() as Partial<MarketplacePolicySettings>), id: 'marketplace' });
      }
      if (callSett?.exists()) {
        const cs = callSett.data()!;
        setCallingSettings({
          webrtcEnabled: cs.webrtcEnabled !== false,
          allowVoiceCalls: cs.allowVoiceCalls !== false,
          allowVideoCalls: cs.allowVideoCalls !== false,
          allowGroupCalls: cs.allowGroupCalls !== false,
          allowScreenSharing: cs.allowScreenSharing !== false,
          maxGroupCallParticipants: Math.max(2, Math.min(50, Number(cs.maxGroupCallParticipants || 8))),
          activeCallingProvider: String(cs.activeCallingProvider || 'webrtc_builtin'),
          stunServers:
            Array.isArray(cs.stunServers) && cs.stunServers.length > 0
              ? cs.stunServers
              : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
          turnRelayHint: cs.turnRelayHint || '',
          turnProvider: cs.turnProvider || 'none',
          maxCallDurationMinutes: Number(cs.maxCallDurationMinutes) || 60,
        });
      }
    } catch (err) {
      logFirestoreError(err, OperationType.LIST, 'admin');
      setErrorMsg(formatFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, adminRole, platformSettings]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const notifyAction = useCallback(
    (msg: string) => {
      setErrorMsg(null);
      setStatusMsg(msg);
      toast.success(msg);
      void loadAll();
    },
    [toast, loadAll]
  );

  const errorAction = useCallback(
    (msg: string) => {
      setErrorMsg(msg);
      toast.error(msg);
    },
    [toast]
  );

  const askConfirm = useCallback((cfg: ConfirmActionState) => {
    setConfirmState(cfg);
  }, []);

  const runConfirmed = async () => {
    if (!confirmState) return;
    setConfirmBusy(true);
    try {
      await confirmState.action();
      setConfirmState(null);
    } catch (err) {
      setErrorMsg(formatFirebaseErrorMessage(err));
      toast.error(formatFirebaseErrorMessage(err));
    } finally {
      setConfirmBusy(false);
    }
  };

  const overviewCounts = useMemo<OverviewCounts>(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const totalUsers = exactCounts.users ?? users.length;
    const activeUsers =
      exactStats.activeUsers ?? users.filter((u) => (u.accountStatus || 'active') === 'active').length;
    const newRegistrations7d = exactStats.registrationsByDay
      ? exactStats.registrationsByDay.reduce((sum, d) => sum + d.value, 0)
      : users.filter((u) => toEpochMs(u.createdAt) >= sevenDaysAgo).length;
    const totalPosts = exactCounts.posts ?? posts.length;
    const videoPostCount = posts.filter((p) => p.type === 'video').length;
    const totalReelsAndVideos = (exactCounts.reels ?? reels.length) + videoPostCount;
    const likesAcrossContent =
      posts.reduce((s, p) => s + Number(p.likesCount || 0), 0) +
      reels.reduce((s, r) => s + Number(r.likesCount || 0), 0);
    const totalCommentsAndReactions =
      (exactCounts.comments ?? comments.length) +
      (exactCounts.voiceComments ?? voiceComments.length) +
      likesAcrossContent;
    const totalMarketplaceProducts = exactCounts.products ?? listings.length;
    const totalCommunities = exactCounts.communities ?? communities.length;
    const activeAdvertisements =
      exactStats.activeAdCampaigns ?? campaigns.filter((c) => c.status === 'active').length;
    const monetizationAppsTotal = applications.length;
    const pendingMonetizationApps =
      exactStats.pendingMonetization ??
      applications.filter((a) => ['pending', 'appealed', 'needs_info'].includes(a.status)).length;
    const pendingReportsTotal =
      (exactStats.pendingReports ?? reports.filter((r) => r.status === 'pending').length) +
      (exactStats.pendingMarketReports ?? marketReports.filter((r) => r.status === 'pending').length);

    const verifiedRevenueUsd =
      adPayments.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amountUsd || 0), 0) +
      paymentRequests
        .filter((pr) => pr.status === 'approved')
        .reduce((s, pr) => s + Number(pr.amountUsd || 0), 0);
    const marketPaidBdt = marketPayments
      .filter((p) => p.status === 'paid' && p.currency === 'BDT')
      .reduce((s, p) => s + Number(p.amount || 0), 0);

    return {
      totalUsers,
      activeUsers,
      newRegistrations7d,
      totalPosts,
      totalReelsAndVideos,
      totalCommentsAndReactions,
      totalMarketplaceProducts,
      totalCommunities,
      activeAdvertisements,
      monetizationAppsTotal,
      pendingMonetizationApps,
      pendingReportsTotal,
      verifiedRevenueUsd,
      marketOrdersTotal: marketOrders.length,
      marketPaidBdt,
      approvedCreators: exactStats.approvedCreators ?? users.filter((u) => u.isCreator === true).length,
      restrictedAccounts:
        exactStats.restrictedUsers ??
        users.filter((u) => ['suspended', 'banned'].includes(String(u.accountStatus || ''))).length,
      totalAdCampaigns: exactStats.totalAdCampaigns ?? campaigns.length,
      exactMetrics:
        exactStats.activeUsers !== undefined &&
        exactStats.pendingReports !== undefined &&
        exactStats.registrationsByDay !== undefined,
    };
  }, [
    exactStats,
    exactCounts,
    users,
    posts,
    reels,
    comments,
    voiceComments,
    listings,
    communities,
    campaigns,
    applications,
    reports,
    marketReports,
    adPayments,
    paymentRequests,
    marketPayments,
    marketOrders,
  ]);

  // ---- Prompt 09: dashboard series + role-filtered administrative alerts (all derived from real data) ----
  const registrationTrend = exactStats.registrationsByDay || [];
  const contentMix = useMemo(
    () => [
      { label: 'Posts', value: exactCounts.posts ?? posts.length },
      { label: 'Reels', value: exactCounts.reels ?? reels.length },
      { label: 'Comments', value: exactCounts.comments ?? comments.length },
      { label: 'Voice comments', value: exactCounts.voiceComments ?? voiceComments.length },
      { label: 'Market products', value: exactCounts.products ?? listings.length },
      { label: 'Communities', value: exactCounts.communities ?? communities.length },
    ],
    [exactCounts, posts, reels, comments, voiceComments, listings, communities]
  );

  const pendingVerificationsCount =
    exactStats.pendingVerifications ??
    verificationRequests.filter((v) => ['pending', 'needs_info'].includes(v.status)).length;
  const pendingPayoutsCount =
    exactStats.pendingPayouts ?? payouts.filter((p) => p.status === 'pending').length;
  const pendingAdsCount =
    exactStats.pendingAdCampaigns ?? campaigns.filter((c) => c.status === 'pending_review').length;
  const pendingPaymentRequestsCount = paymentRequests.filter((r) => r.status === 'pending').length;

  const allAlerts = useMemo(
    () =>
      buildAdminAlerts({
        pendingReports: exactStats.pendingReports ?? reports.filter((r) => r.status === 'pending').length,
        pendingMarketplaceReports:
          exactStats.pendingMarketReports ?? marketReports.filter((r) => r.status === 'pending').length,
        pendingVerifications: pendingVerificationsCount,
        pendingMonetizationApps: overviewCounts.pendingMonetizationApps,
        pendingPayoutRequests: pendingPayoutsCount,
        pendingPaymentRequests: pendingPaymentRequestsCount,
        pendingAdCampaigns: pendingAdsCount,
        pendingSellerApplications:
          exactStats.pendingSellerApps ?? sellerApplications.filter((a) => a.status === 'pending').length,
        marketPaymentsAwaitingVerification: marketPayments.filter((p) => p.status === 'awaiting_verification').length,
        failedOrUnverifiedAdPayments: adPayments.filter((p) => p.status === 'awaiting_verification').length,
        maintenanceMode: Boolean(platFormSettings.maintenanceMode),
        registrationOpen: platFormSettings.registrationOpen !== false,
        cloudFunctionsExpected: CLOUD_FUNCTIONS_ENABLED,
        backendConfigured: Boolean(getBackendBaseUrl()),
        backendReachable,
      }),
    [
      exactStats,
      reports,
      marketReports,
      pendingVerificationsCount,
      overviewCounts.pendingMonetizationApps,
      pendingPayoutsCount,
      pendingPaymentRequestsCount,
      pendingAdsCount,
      sellerApplications,
      marketPayments,
      adPayments,
      platFormSettings,
      backendReachable,
    ]
  );
  const visibleAlerts = useMemo(
    () => allAlerts.filter((a) => canSeeAdminAlert(adminRole, a.kind)),
    [allAlerts, adminRole]
  );
  const activeAlertCount = useMemo(
    () => visibleAlerts.filter((a) => isAlertActive(a, alertAck)).length,
    [visibleAlerts, alertAck]
  );

  const persistAcknowledgements = useCallback(
    async (next: Record<string, number>) => {
      if (!firebaseUser) return;
      // keep the stored map small: only keys of alerts that still exist for this staff member
      const liveKeys = new Set(visibleAlerts.map((a) => a.key));
      const pruned: Record<string, number> = {};
      Object.entries(next).forEach(([k, v]) => {
        if (liveKeys.has(k)) pruned[k] = v;
      });
      try {
        await setDoc(doc(db, 'adminAlertState', firebaseUser.uid), {
          uid: firebaseUser.uid,
          acknowledged: pruned,
          updatedAt: serverTimestamp(),
        });
        setAlertAck(pruned);
      } catch (err) {
        toast.error(formatFirebaseErrorMessage(err));
      }
    },
    [firebaseUser, visibleAlerts, toast]
  );
  const acknowledgeAlert = useCallback(
    (alert: AdminAlert) => persistAcknowledgements({ ...alertAck, [alert.key]: alert.count }),
    [alertAck, persistAcknowledgements]
  );
  const acknowledgeAllAlerts = useCallback(
    (alerts: AdminAlert[]) => {
      const next = { ...alertAck };
      alerts.forEach((a) => {
        next[a.key] = a.count;
      });
      return persistAcknowledgements(next);
    },
    [alertAck, persistAcknowledgements]
  );

  if (!firebaseUser || !adminRole) {
    return (
      <AdminShell>
        <div className="max-w-md mx-auto py-20 px-4 text-center space-y-4">
          <div className="mx-auto h-12 w-12 rounded-2xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 flex items-center justify-center">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h1 className="font-display font-bold text-xl">Authorized Admin Access Required</h1>
          <p className="text-sm text-neutral-500">
            This control panel is strictly limited to authorized BANA administrators with verified RBAC credentials.
          </p>
        </div>
      </AdminShell>
    );
  }

  const pendingVerifications = pendingVerificationsCount;
  const pendingPayouts = pendingPayoutsCount;
  const pendingAds = pendingAdsCount;
  const pendingPaymentRequests = pendingPaymentRequestsCount;

  return (
    <AdminShell fullBleed>
      <div className="max-w-7xl mx-auto px-4 lg:px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-5 pb-24 lg:pb-8">
        {/* Sidebar Navigation (Filtered by Strict RBAC) */}
        <aside className="lg:col-span-3 space-y-2">
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-mono uppercase tracking-wider text-[#1877F2] font-bold">
                Super Admin Panel
              </p>
              <button
                type="button"
                onClick={() => void loadAll()}
                title="Refresh Firestore metrics"
                className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <h1 className="font-display font-bold text-base">BANA Control Center</h1>
            <p className="text-xs text-neutral-500 truncate">{firebaseUser.email}</p>
            <p className="font-mono text-[11px] font-semibold text-neutral-700 dark:text-neutral-300">
              Role: {getAdminRoleLabel(adminRole)}
            </p>
            <p className="font-mono text-[10px] text-neutral-500 pt-0.5">
              Plan: {FIREBASE_PLAN_MODE.toUpperCase()} · Functions: {CLOUD_FUNCTIONS_ENABLED ? 'Active' : 'Disabled'}
            </p>
          </div>

          <nav className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2 flex lg:flex-col gap-1 overflow-x-auto">
            {visibleNavItems.map((mod, idx) => {
              const Icon = mod.icon;
              const showGroup = idx === 0 || visibleNavItems[idx - 1].group !== mod.group;
              return (
                <React.Fragment key={mod.id}>
                  {showGroup && (
                    <p className="hidden lg:block px-3 pt-2 pb-0.5 text-[10px] font-mono uppercase tracking-wider text-neutral-400">
                      {mod.group}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setStatusMsg(null);
                      setErrorMsg(null);
                      setActiveMod(mod.id);
                    }}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left whitespace-nowrap transition-colors ${
                      activeMod === mod.id
                        ? 'bg-[#1877F2] text-white'
                        : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="flex-1">{mod.label}</span>
                    {mod.id === 'alerts' && activeAlertCount > 0 && (
                      <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold inline-flex items-center justify-center">
                        {activeAlertCount}
                      </span>
                    )}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>
        </aside>

        {/* Main Workspace */}
        <section className="lg:col-span-9 space-y-4">
          {statusMsg && (
            <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-xs text-emerald-700 dark:text-emerald-300">
              {statusMsg}
            </div>
          )}
          {errorMsg && (
            <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 px-4 py-2.5 text-xs text-rose-700 dark:text-rose-300">
              {errorMsg}
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-sm text-neutral-500">
              Loading real-time Firestore administration telemetry...
            </div>
          ) : (
            <>
              {activeMod === 'overview' && (
                <AdminOverviewSection
                  counts={overviewCounts}
                  pendingVerifications={pendingVerifications}
                  pendingPayouts={pendingPayouts}
                  pendingAds={pendingAds}
                  pendingPaymentRequests={pendingPaymentRequests}
                  auditLogs={auditLogs}
                  registrationTrend={registrationTrend}
                  contentMix={contentMix}
                  platformSettings={platFormSettings}
                  callingEnabled={callingSettings.webrtcEnabled}
                  onBackendHealth={setBackendReachable}
                  canNavigate={(mod) => canAccessAdminModule(adminRole, mod)}
                  onNavigateModule={(mod) => setActiveMod(mod)}
                />
              )}

              {activeMod === 'alerts' && (
                <AdminAlertsSection
                  alerts={visibleAlerts}
                  acknowledged={alertAck}
                  onOpenModule={(mod) => setActiveMod(mod)}
                  onAcknowledge={acknowledgeAlert}
                  onAcknowledgeAll={acknowledgeAllAlerts}
                />
              )}

              {activeMod === 'users' && (
                <AdminUsersSection
                  users={users}
                  userEmailsByUid={userEmailsByUid}
                  reports={reports}
                  posts={posts}
                  reels={reels}
                  listings={listings}
                  communities={communities}
                  marketOrders={marketOrders}
                  currentAdminUid={firebaseUser.uid}
                  canManageUsers={canPerformAdminAction(adminRole, 'manage_users')}
                  canGrantVerification={adminRole === 'super_admin'}
                  actorEmail={firebaseUser.email || ''}
                  actorRole={adminRole || ''}
                  initialSearch={userSearchInitial}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'verifications' && (
                <AdminVerificationsSection
                  currentUid={firebaseUser.uid}
                  verificationRequests={verificationRequests}
                  canManageVerifications={canPerformAdminAction(adminRole, 'manage_verifications')}
                  canGrantVerification={adminRole === 'super_admin'}
                  actorEmail={firebaseUser.email || ''}
                  actorRole={adminRole || ''}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'smart_video' && (
                <AdminSmartVideoSection
                  currentUid={firebaseUser.uid}
                  canEditSettings={canPerformAdminAction(adminRole, 'manage_video_distribution_settings')}
                  canModerate={canPerformAdminAction(adminRole, 'moderate_video_distribution')}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                />
              )}

              {activeMod === 'friend_suggestions' && (
                <AdminFriendSuggestionsSection
                  currentUid={firebaseUser.uid}
                  canEdit={canPerformAdminAction(adminRole, 'manage_friend_suggestions')}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                />
              )}

              {activeMod === 'paid_verifications' && (
                <AdminPaidVerificationSection
                  currentUid={firebaseUser.uid}
                  canManage={canPerformAdminAction(adminRole, 'manage_paid_verifications')}
                  canEditSettings={canPerformAdminAction(adminRole, 'manage_verification_payment_settings')}
                  actorEmail={firebaseUser.email || ''}
                  actorRole={adminRole || ''}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'content' && (
                <AdminContentSection
                  posts={posts}
                  reels={reels}
                  stories={stories}
                  comments={comments}
                  voiceComments={voiceComments}
                  reports={reports}
                  canModerateContent={canPerformAdminAction(adminRole, 'moderate_content')}
                  onInspectCreator={(term) => {
                    setUserSearchInitial(term);
                    setActiveMod('users');
                  }}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'storage_recovery' && (
                <AdminStorageRecoverySection
                  currentUid={firebaseUser.uid}
                  currentEmail={firebaseUser.email || ''}
                  comments={comments}
                  reels={reels}
                  canManage={canPerformAdminAction(adminRole, 'manage_storage_recovery')}
                  onNotifyAction={notifyAction}
                  onErrorAction={errorAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'messenger_calling' && (
                <AdminMessengerCallingSection
                  reports={reports}
                  users={users}
                  callsLog={callsLog}
                  initialCallingSettings={callingSettings}
                  canManageUsers={canPerformAdminAction(adminRole, 'manage_users')}
                  canManageCalling={canPerformAdminAction(adminRole, 'manage_calling_settings')}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'api_management' && (
                <AdminApiManagementSection
                  currentUid={firebaseUser.uid}
                  canManage={canPerformAdminAction(adminRole, 'manage_api_providers')}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onErrorAction={errorAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'marketplace' && (
                <AdminMarketplaceSection
                  listings={listings}
                  stores={stores}
                  marketOrders={marketOrders}
                  productCategories={productCategories}
                  gatewayStatus={gatewayStatus}
                  gwCodEnabled={gwCodEnabled}
                  gwManualMobileEnabled={gwManualMobileEnabled}
                  onSetGwCodEnabled={setGwCodEnabled}
                  onSetGwManualMobileEnabled={setGwManualMobileEnabled}
                  canManageMarket={canPerformAdminAction(adminRole, 'manage_marketplace')}
                  canManageFinance={canPerformAdminAction(adminRole, 'manage_finance')}
                  sellerApplications={sellerApplications}
                  productReviews={productReviewDocs}
                  currentUid={firebaseUser?.uid || ''}
                  currentName={profile?.displayName || firebaseUser?.email || 'BANA Admin'}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'communities' && (
                <AdminCommunitiesSection
                  communities={communities}
                  events={communityEvents}
                  users={users}
                  marketReports={marketReports}
                  canManageCommunities={canPerformAdminAction(adminRole, 'manage_communities')}
                  canTransferOwner={canPerformAdminAction(adminRole, 'transfer_community_owner')}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'monetization' && (
                <AdminMonetizationSection
                  currentUid={firebaseUser.uid}
                  users={users}
                  applications={applications}
                  earnings={earnings}
                  monetizationPolicy={monetizationPolicy}
                  minWithdrawalUsd={minWithdrawalUsd}
                  onSetMinWithdrawalUsd={setMinWithdrawalUsd}
                  canReviewApps={canPerformAdminAction(adminRole, 'manage_monetization_apps')}
                  canManageFinance={canPerformAdminAction(adminRole, 'manage_finance')}
                  policyHistory={policyHistory}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onErrorAction={errorAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'ads' && (
                <AdminAdsSection
                  currentUid={firebaseUser.uid}
                  campaigns={campaigns}
                  advertisers={advertisers}
                  adCreatives={adCreatives}
                  reports={reports}
                  adSettings={adSettings}
                  onSetAdSettings={setAdSettings}
                  canManageAds={canPerformAdminAction(adminRole, 'manage_ads')}
                  policyHistory={policyHistory}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onErrorAction={errorAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'finance' && canPerformAdminAction(adminRole, 'manage_finance') && (
                <AdminFinanceSection
                  currentUid={firebaseUser.uid}
                  payouts={payouts}
                  marketPayments={marketPayments}
                  adPayments={adPayments}
                  paymentRequests={paymentRequests}
                  boostPackages={boostPackages}
                  financialTxs={financialTxs}
                  campaigns={campaigns}
                  earnings={earnings}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onErrorAction={errorAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'reports' && (
                <AdminReportsSection
                  reports={reports}
                  marketReports={marketReports}
                  canModerateContent={canPerformAdminAction(adminRole, 'moderate_content')}
                  currentUid={firebaseUser.uid}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'notifications' && (
                <AdminNotificationsSection
                  currentUid={firebaseUser.uid}
                  canDispatch={canPerformAdminAction(adminRole, 'dispatch_notifications')}
                  users={users}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                />
              )}

              {activeMod === 'platform_settings' && (
                <AdminPlatformSettingsSection
                  initialSettings={platFormSettings}
                  initialMarketPolicy={marketPolicy}
                  canEditPlatformSettings={canPerformAdminAction(adminRole, 'manage_platform_settings')}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'admin_roles' && (
                <AdminRbacSection
                  currentUid={firebaseUser.uid}
                  adminRole={adminRole}
                  claimsAdminRole={claimsAdminRole}
                  users={users}
                  userEmailsByUid={userEmailsByUid}
                  adminRolesList={adminRolesList}
                  auditLogs={auditLogs}
                  onWriteAudit={writeAudit}
                  onNotifyAction={notifyAction}
                  onAskConfirm={askConfirm}
                />
              )}

              {activeMod === 'audit_logs' && <AdminAuditLogsSection auditLogs={auditLogs} />}
            </>
          )}
        </section>
      </div>

      <ConfirmDialog
        isOpen={Boolean(confirmState)}
        title={confirmState?.title || ''}
        description={confirmState?.description || ''}
        confirmLabel={confirmState?.confirmLabel || 'Confirm'}
        variant={confirmState?.variant || 'danger'}
        loading={confirmBusy}
        onConfirm={runConfirmed}
        onCancel={() => {
          if (!confirmBusy) setConfirmState(null);
        }}
      />
    </AdminShell>
  );
}
