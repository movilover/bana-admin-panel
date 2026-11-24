import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import type {
  AdCampaign,
  AdClickRecord,
  AdImpressionRecord,
  AdPlacement,
  AdvertiserAccount,
  AdvertisingSettings,
  DiscoveryCategory,
} from '@/src/types/bana';
import { getOrCreateSessionKey } from '@/src/lib/monetization';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';

export const DEFAULT_ADVERTISING_SETTINGS: AdvertisingSettings = {
  id: 'default',
  adsEnabled: true,
  enabledPlacements: ['home_feed', 'reels_feed', 'marketplace'],
  blockedCategories: [],
  defaultCpmUsd: 2.5,
  defaultCpcUsd: 0.08,
  minDailyBudgetUsd: 5,
  minTotalBudgetUsd: 10,
  frequencyCapPerSession: 3,
  requireManualReview: true,
};

const DISMISSED_ADS_KEY = 'bana_dismissed_ads_v1';
const AD_FREQ_KEY = 'bana_ad_freq_v1';

export function getDismissedAdIds(): string[] {
  try {
    const raw = sessionStorage.getItem(DISMISSED_ADS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function dismissAdForSession(campaignId: string): void {
  try {
    const list = new Set(getDismissedAdIds());
    list.add(campaignId);
    sessionStorage.setItem(DISMISSED_ADS_KEY, JSON.stringify(Array.from(list)));
  } catch {
    // ignore storage limits
  }
}

function getSessionAdImpressionCounts(): Record<string, number> {
  try {
    const raw = sessionStorage.getItem(AD_FREQ_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function incrementSessionAdFrequency(campaignId: string): void {
  try {
    const counts = getSessionAdImpressionCounts();
    counts[campaignId] = (counts[campaignId] || 0) + 1;
    sessionStorage.setItem(AD_FREQ_KEY, JSON.stringify(counts));
  } catch {
    // ignore storage limits
  }
}

export async function fetchAdvertisingSettings(): Promise<AdvertisingSettings> {
  try {
    const snap = await getDoc(doc(db, 'advertisingSettings', 'default'));
    if (!snap.exists()) return DEFAULT_ADVERTISING_SETTINGS;
    const data = snap.data() as Partial<AdvertisingSettings>;
    return {
      ...DEFAULT_ADVERTISING_SETTINGS,
      ...data,
      enabledPlacements:
        Array.isArray(data.enabledPlacements) && data.enabledPlacements.length > 0
          ? data.enabledPlacements
          : DEFAULT_ADVERTISING_SETTINGS.enabledPlacements,
      blockedCategories: Array.isArray(data.blockedCategories) ? data.blockedCategories : [],
    };
  } catch {
    return DEFAULT_ADVERTISING_SETTINGS;
  }
}

export async function fetchOrCreateAdvertiserAccount(params: {
  uid: string;
  email: string;
  displayName: string;
}): Promise<AdvertiserAccount> {
  const ref = doc(db, 'advertisers', params.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return snap.data() as AdvertiserAccount;
  }

  const initial: AdvertiserAccount = {
    uid: params.uid,
    businessName: params.displayName || 'BANA Advertiser',
    contactEmail: params.email || '',
    website: '',
    country: 'Bangladesh',
    billingCurrency: 'USD',
    status: 'active',
    walletBalanceUsd: 0,
    lifetimeDepositUsd: 0,
    lifetimeSpendUsd: 0,
    verifiedAdvertiser: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(ref, initial);
  } catch {
    // Return shape safely even if user is unverified / read-only preview
  }
  return initial;
}

export async function fetchEligibleAdsForPlacement(
  placement: AdPlacement,
  context: {
    isAdult: boolean;
    district?: string;
    interests?: DiscoveryCategory[];
    categoryFilter?: string;
    viewerUid?: string;
  }
): Promise<AdCampaign[]> {
  // Never deliver personalized or adult-targeted campaigns to minor accounts
  if (!context.isAdult) return [];

  try {
    const adSettings = await fetchAdvertisingSettings();
    if (!adSettings.adsEnabled) return [];
    if (!adSettings.enabledPlacements.includes(placement)) return [];

    const { items: rawCampaigns } = await getDocsWithIndexFallback<AdCampaign>(
      query(collection(db, 'adCampaigns'), where('status', '==', 'active'), orderBy('createdAt', 'desc'), limit(25)),
      query(collection(db, 'adCampaigns'), where('status', '==', 'active'), limit(40)),
      sortByCreatedAtDesc
    );

    const today = new Date().toISOString().slice(0, 10);
    const dismissed = new Set(getDismissedAdIds());
    const freqCounts = getSessionAdImpressionCounts();
    const blocked = new Set((adSettings.blockedCategories || []).map((c) => c.toLowerCase()));

    const scored = rawCampaigns
      .filter((c) => {
        if (dismissed.has(c.id)) return false;
        if (context.viewerUid && c.advertiserId === context.viewerUid) return false;
        if ((freqCounts[c.id] || 0) >= (adSettings.frequencyCapPerSession || 3)) return false;
        if (c.startDate && today < c.startDate) return false;
        if (c.endDate && today > c.endDate) return false;
        if (Number(c.spentUsd || 0) >= Number(c.totalBudgetUsd || 0)) return false;
        if (c.categoryTag && blocked.has(c.categoryTag.toLowerCase())) return false;

        const placements =
          Array.isArray(c.placements) && c.placements.length > 0
            ? c.placements
            : c.campaignType === 'sponsored_reel'
            ? (['reels_feed'] as AdPlacement[])
            : c.campaignType === 'marketplace_promo'
            ? (['marketplace'] as AdPlacement[])
            : (['home_feed'] as AdPlacement[]);
        if (!placements.includes(placement)) return false;

        // Non-PII district filter check if specific districts are selected
        const targetDistricts = c.targeting?.districts || [];
        if (
          targetDistricts.length > 0 &&
          !targetDistricts.includes('All Districts') &&
          context.district &&
          context.district !== 'All Districts' &&
          !targetDistricts.some((td) => td.toLowerCase() === context.district!.toLowerCase())
        ) {
          return false;
        }

        return true;
      })
      .map((c) => {
        let relevance = 1;
        const interests = c.targeting?.interests || [];
        if (context.interests && interests.some((i) => context.interests!.includes(i))) {
          relevance += 3;
        }
        if (
          context.categoryFilter &&
          context.categoryFilter !== 'All' &&
          c.targeting?.categories?.some((cat) => cat.toLowerCase() === context.categoryFilter!.toLowerCase())
        ) {
          relevance += 3;
        }
        return { campaign: c, relevance };
      })
      .sort((a, b) => b.relevance - a.relevance);

    return scored.map((s) => s.campaign);
  } catch {
    return [];
  }
}

export async function trackAdDelivery(
  campaign: AdCampaign,
  placement: AdPlacement,
  eventType: 'impression' | 'click',
  viewerUid?: string
): Promise<boolean> {
  const sessionKey = getOrCreateSessionKey();
  const dedupeClientKey = `bana_ad_${eventType}_${campaign.id}_${placement}`;
  if (eventType === 'impression') {
    try {
      if (sessionStorage.getItem(dedupeClientKey)) return false;
      sessionStorage.setItem(dedupeClientKey, '1');
      incrementSessionAdFrequency(campaign.id);
    } catch {
      // ignore storage issues
    }
  }

  try {
    const res = await invokeCloudFunction<Record<string, unknown>, { recorded?: boolean }>(
      'trackAdDeliveryEvent',
      {
        campaignId: campaign.id,
        placement,
        eventType,
        sessionKey,
      }
    );
    return Boolean(res?.recorded);
  } catch {
    // Rule-compliant fallback for authenticated viewers if Cloud Functions aren't deployed yet
    if (!viewerUid) return false;
    try {
      const col = eventType === 'click' ? 'adClicks' : 'adImpressions';
      await addDoc(collection(db, col), {
        campaignId: campaign.id,
        advertiserId: campaign.advertiserId,
        placement,
        viewerId: viewerUid,
        sessionKey,
        dayKey: new Date().toISOString().slice(0, 10),
        createdAt: serverTimestamp(),
      });
      return true;
    } catch {
      return false;
    }
  }
}

export interface CampaignAggregateStats {
  totalImpressions: number;
  totalReach: number;
  totalClicks: number;
  ctrPct: number;
  totalSpendUsd: number;
  totalBudgetUsd: number;
  activeCount: number;
  pendingCount: number;
  dailySeries: Array<{ date: string; impressions: number; clicks: number; spendUsd: number }>;
}

export function computeCampaignAnalytics(
  campaigns: AdCampaign[],
  impressions: AdImpressionRecord[],
  clicks: AdClickRecord[]
): CampaignAggregateStats {
  const totalImpressions = campaigns.reduce((s, c) => s + Number(c.impressions || 0), 0);
  // Reach is ONLY what was actually recorded; never substituted with impressions (that would be an estimate shown as fact).
  const totalReach = campaigns.reduce((s, c) => s + Number(c.reachCount || 0), 0);
  const totalClicks = campaigns.reduce((s, c) => s + Number(c.clicks || 0), 0);
  const ctrPct = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
  const totalSpendUsd = Number(campaigns.reduce((s, c) => s + Number(c.spentUsd || 0), 0).toFixed(2));
  const totalBudgetUsd = Number(campaigns.reduce((s, c) => s + Number(c.totalBudgetUsd || 0), 0).toFixed(2));
  const activeCount = campaigns.filter((c) => c.status === 'active').length;
  const pendingCount = campaigns.filter((c) => c.status === 'pending_review').length;

  const dayMap = new Map<string, { date: string; impressions: number; clicks: number; spendUsd: number }>();
  impressions.forEach((imp) => {
    const day = imp.dayKey || new Date().toISOString().slice(0, 10);
    const cur = dayMap.get(day) || { date: day, impressions: 0, clicks: 0, spendUsd: 0 };
    cur.impressions += 1;
    cur.spendUsd += Number(imp.costChargedUsd || 0);
    dayMap.set(day, cur);
  });
  clicks.forEach((clk) => {
    const day = clk.dayKey || new Date().toISOString().slice(0, 10);
    const cur = dayMap.get(day) || { date: day, impressions: 0, clicks: 0, spendUsd: 0 };
    cur.clicks += 1;
    cur.spendUsd += Number(clk.costChargedUsd || 0);
    dayMap.set(day, cur);
  });

  const dailySeries = Array.from(dayMap.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14);

  return {
    totalImpressions,
    totalReach,
    totalClicks,
    ctrPct,
    totalSpendUsd,
    totalBudgetUsd,
    activeCount,
    pendingCount,
    dailySeries,
  };
}
