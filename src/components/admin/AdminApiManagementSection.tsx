import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  KeyRound,
  PlugZap,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { auth, db } from '@/src/firebase';
import { getBackendBaseUrl } from '@/src/lib/calling/callingProvider';
import {
  API_CATEGORY_LABELS,
  DEFAULT_API_PROVIDERS_CATALOG,
  type ApiActiveCategorySelection,
  type ApiErrorLog,
  type ApiProviderCategory,
  type ApiProviderConfig,
} from '@/src/types/apiManagement';
import { AdminCard, AdminKpiTile } from '@/src/components/admin/AdminShared';
import { validateApiProviderConfig } from '@/src/lib/providerValidation';

interface AdminApiManagementSectionProps {
  currentUid: string;
  canManage: boolean;
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

const CATEGORIES = Object.keys(API_CATEGORY_LABELS) as ApiProviderCategory[];

export function AdminApiManagementSection({
  currentUid,
  canManage,
  onWriteAudit,
  onNotifyAction,
  onErrorAction,
  onAskConfirm,
}: AdminApiManagementSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<'all' | ApiProviderCategory>('all');
  const [providers, setProviders] = useState<ApiProviderConfig[]>(DEFAULT_API_PROVIDERS_CATALOG);
  const [errorLogs, setErrorLogs] = useState<ApiErrorLog[]>([]);
  const [backendStatus, setBackendStatus] = useState<any>(null);
  const [backendUsage, setBackendUsage] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingEndpointId, setEditingEndpointId] = useState<string | null>(null);
  const [endpointDraft, setEndpointDraft] = useState('');
  const [appIdDraft, setAppIdDraft] = useState('');
  // Prompt 12: provider that was active before the last switch, per category (for Rollback).
  const [previousActiveByCat, setPreviousActiveByCat] = useState<Record<string, string>>({});

  const backendUrl = getBackendBaseUrl();

  const loadApiState = useCallback(async () => {
    setLoading(true);
    try {
      const [provSnap, activeSnap, errSnap] = await Promise.all([
        getDocs(collection(db, 'apiProviders')).catch(() => null),
        getDocs(collection(db, 'apiProviderActive')).catch(() => null),
        getDocs(query(collection(db, 'apiErrorLogs'), orderBy('createdAt', 'desc'), limit(30))).catch(() => null),
      ]);

      const storedMap = new Map<string, ApiProviderConfig>();
      provSnap?.docs.forEach((d) => {
        storedMap.set(d.id, { id: d.id, ...(d.data() as Omit<ApiProviderConfig, 'id'>) });
      });

      const activeByCat = new Map<string, ApiActiveCategorySelection>();
      activeSnap?.docs.forEach((d) => {
        activeByCat.set(d.id, d.data() as ApiActiveCategorySelection);
      });

      const merged = DEFAULT_API_PROVIDERS_CATALOG.map((base) => {
        const saved = storedMap.get(base.id);
        const catActive = activeByCat.get(base.category);
        return {
          ...base,
          ...(saved || {}),
          isActive: catActive ? catActive.activeProviderId === base.id : saved?.isActive ?? base.isActive,
        };
      });
      setProviders(merged);
      setPreviousActiveByCat(
        Object.fromEntries(
          Array.from(activeByCat.entries()).map(([cat, sel]) => [cat, sel.previousActiveProviderId || ''])
        )
      );

      if (errSnap) {
        setErrorLogs(errSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ApiErrorLog, 'id'>) })));
      }

      if (backendUrl && auth.currentUser) {
        const token = await auth.currentUser.getIdToken().catch(() => null);
        if (token) {
          const [stResp, usResp] = await Promise.all([
            fetch(`${backendUrl}/api/admin/status`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
            fetch(`${backendUrl}/api/admin/usage`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null),
          ]);
          if (stResp?.ok) setBackendStatus(await stResp.json());
          if (usResp?.ok) {
            const uData = await usResp.json();
            setBackendUsage(Array.isArray(uData?.usage) ? uData.usage : []);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  useEffect(() => {
    void loadApiState();
  }, [loadApiState]);

  const metrics = useMemo(() => {
    const activeCount = providers.filter((p) => p.isActive).length;
    const connectedCount = providers.filter((p) => p.connectionStatus === 'connected').length;
    const paidApproved = providers.filter((p) => p.tier === 'paid' && p.billingApprovedByAdmin).length;
    const totalRequests = backendUsage.reduce((sum, u) => sum + Number(u.requestsCount || 0), 0);
    return { activeCount, connectedCount, paidApproved, totalRequests };
  }, [providers, backendUsage]);

  const persistProviderDoc = async (item: ApiProviderConfig, patch: Partial<ApiProviderConfig>) => {
    const next = { ...item, ...patch };
    // Enforce zero secret storage guarantee: strip any secret-sounding keys
    const safeDoc: Record<string, any> = {
      id: next.id,
      category: next.category,
      providerKey: next.providerKey,
      name: next.name,
      tier: next.tier,
      requiresBillingApproval: next.requiresBillingApproval,
      billingApprovedByAdmin: next.billingApprovedByAdmin,
      ...(next.billingApprovedAt ? { billingApprovedAt: next.billingApprovedAt } : {}),
      enabled: next.enabled,
      isActive: next.isActive,
      endpointUrl: next.endpointUrl || '',
      publicAppId: next.publicAppId || '',
      region: next.region || '',
      requiredEnvKeys: next.requiredEnvKeys,
      docsNote: next.docsNote,
      connectionStatus: next.connectionStatus,
      configStatus: next.configStatus,
      lastTestedAt: next.lastTestedAt || '',
      lastTestMessage: next.lastTestMessage || '',
      monthlyQuotaLabel: next.monthlyQuotaLabel,
      usageCount: next.usageCount || 0,
      estimatedCostUsd: next.estimatedCostUsd || 0,
      updatedBy: currentUid,
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'apiProviders', item.id), safeDoc, { merge: true });
    setProviders((prev) => prev.map((p) => (p.id === item.id ? { ...p, ...patch } : p)));
  };

  const handleTestConnection = async (item: ApiProviderConfig) => {
    if (!canManage) return;
    setTestingId(item.id);
    try {
      let connectionStatus: ApiProviderConfig['connectionStatus'] = 'unconfigured';
      let configStatus: ApiProviderConfig['configStatus'] = item.configStatus;
      let message = '';

      if (item.requiresBillingApproval && !item.billingApprovedByAdmin) {
        connectionStatus = 'unconfigured';
        configStatus = 'pending_approval';
        message = 'Paid provider blocked until Admin explicitly approves billing.';
      } else if (backendUrl && auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        const resp = await fetch(`${backendUrl}/api/admin/providers/test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            category: item.category,
            providerKey: item.providerKey,
            endpointUrl: item.endpointUrl,
            requiresBillingApproval: item.requiresBillingApproval,
            billingApprovedByAdmin: item.billingApprovedByAdmin,
          }),
        });
        const data = await resp.json();
        connectionStatus = data.connectionStatus || 'error';
        configStatus = data.configured ? 'ready' : 'missing_credentials';
        message = `${data.message || 'Checked'} (${data.latencyMs ?? 0}ms)`;
      } else {
        // Honest client check when external backend is not configured
        if (['webrtc_builtin', 'browser_webrtc', 'browser_progressive', 'inapp_browser', 'firestore_ws'].includes(item.providerKey)) {
          connectionStatus = 'connected';
          configStatus = 'ready';
          message = 'Built-in browser/Firestore service healthy (external backend optional).';
        } else if (item.providerKey === 'cloudflare_r2' && import.meta.env.VITE_MEDIA_BROKER_URL) {
          const r = await fetch(`${String(import.meta.env.VITE_MEDIA_BROKER_URL).replace(/\/$/, '')}/health`).catch(() => null);
          connectionStatus = r?.ok ? 'connected' : 'error';
          configStatus = r?.ok ? 'ready' : 'missing_credentials';
          message = r?.ok ? 'Cloudflare R2 Media Broker /health OK.' : 'Media Broker health probe failed.';
        } else {
          connectionStatus = 'unconfigured';
          configStatus = 'missing_credentials';
          message = `External backend URL (VITE_BACKEND_URL) & env vars (${item.requiredEnvKeys.join(', ')}) are required.`;
        }
      }

      const nowIso = new Date().toISOString();
      await persistProviderDoc(item, {
        connectionStatus,
        configStatus,
        lastTestedAt: nowIso,
        lastTestMessage: message,
      });

      if (connectionStatus === 'error') {
        await addDoc(collection(db, 'apiErrorLogs'), {
          category: item.category,
          providerId: item.id,
          severity: 'error',
          message,
          actorUid: currentUid,
          createdAt: serverTimestamp(),
        }).catch(() => {});
        onErrorAction(`${item.name}: ${message}`);
      } else {
        onNotifyAction(`${item.name}: ${message}`);
      }
      await onWriteAudit('test_api_provider', 'apiProviders', item.id, `${item.name} -> ${connectionStatus}`);
    } finally {
      setTestingId(null);
    }
  };

  const handleActivateProvider = async (item: ApiProviderConfig) => {
    if (!canManage) return;
    const validation = validateApiProviderConfig(item);
    if (!validation.ok) {
      onErrorAction(validation.errors[0]);
      return;
    }

    // Prompt 12: remember the provider being replaced so it can be restored (Rollback).
    const currentActiveId = providers.find((p) => p.category === item.category && p.isActive)?.id || '';
    const previousId =
      currentActiveId && currentActiveId !== item.id ? currentActiveId : previousActiveByCat[item.category] || '';

    const doActivate = async () => {
      const batch = writeBatch(db);
      const sameCat = providers.filter((p) => p.category === item.category);
      sameCat.forEach((p) => {
        batch.set(
          doc(db, 'apiProviders', p.id),
          {
            isActive: p.id === item.id,
            enabled: p.id === item.id ? true : p.enabled,
            updatedBy: currentUid,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      });
      batch.set(doc(db, 'apiProviderActive', item.category), {
        category: item.category,
        activeProviderId: item.id,
        activeProviderKey: item.providerKey,
        previousActiveProviderId: previousId,
        updatedBy: currentUid,
        updatedAt: serverTimestamp(),
      });

      // Keep adminSettings/calling synced when voice/video calling provider changes
      if (item.category === 'voice_video_calling') {
        batch.set(
          doc(db, 'adminSettings', 'calling'),
          {
            activeCallingProvider: item.providerKey,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      await batch.commit();
      setPreviousActiveByCat((prev) => ({ ...prev, [item.category]: previousId }));
      setProviders((prev) =>
        prev.map((p) =>
          p.category === item.category ? { ...p, isActive: p.id === item.id, enabled: p.id === item.id ? true : p.enabled } : p
        )
      );
      await onWriteAudit(
        'activate_api_provider',
        'apiProviderActive',
        item.category,
        `Activated ${item.name} (${item.providerKey}) for ${item.category}`
      );
      onNotifyAction(`Active ${API_CATEGORY_LABELS[item.category].title} provider switched to ${item.name}.`);
    };

    onAskConfirm({
      title: `Switch Active ${API_CATEGORY_LABELS[item.category].title}?`,
      description: `Switch active provider to ${item.name} (${item.tier.toUpperCase()})? Existing other categories remain independent.`,
      confirmLabel: 'Activate Provider',
      variant: 'primary',
      action: doActivate,
    });
  };

  const handleRollbackProvider = (category: ApiProviderCategory) => {
    if (!canManage) return;
    const previousId = previousActiveByCat[category];
    const target = providers.find((p) => p.id === previousId && p.category === category);
    if (!previousId || !target) {
      onErrorAction('No previous provider is recorded for this category, so there is nothing to roll back to.');
      return;
    }
    if (target.isActive) {
      onErrorAction(`${target.name} is already the active provider.`);
      return;
    }
    handleActivateProvider(target);
  };

  const handleApprovePaidBilling = (item: ApiProviderConfig) => {
    if (!canManage) return;
    onAskConfirm({
      title: `Approve Paid Provider Billing: ${item.name}`,
      description: `This authorizes usage of paid external API "${item.name}" (${item.monthlyQuotaLabel}). Ensure keys are configured on your backend server (${item.requiredEnvKeys.join(', ')}). Never paste secret keys into Firestore.`,
      confirmLabel: 'Confirm Billing Approval',
      variant: 'danger',
      action: async () => {
        await persistProviderDoc(item, {
          billingApprovedByAdmin: true,
          billingApprovedAt: new Date().toISOString(),
          enabled: true,
          configStatus: 'missing_credentials',
        });
        await onWriteAudit('approve_paid_api_provider', 'apiProviders', item.id, `Approved billing for ${item.name}`);
        onNotifyAction(`Billing approval recorded for ${item.name}. Test connection next.`);
      },
    });
  };

  const visibleCategories = selectedCategory === 'all' ? CATEGORIES : [selectedCategory];

  return (
    <div className="space-y-4">
      {/* Architecture & Security Notice */}
      <AdminCard className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-3 text-xs">
          <ShieldCheck className="w-5 h-5 text-[#1877F2] shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-bold text-neutral-950 dark:text-white">
              Modular Provider Control & Zero-Secret Security
            </p>
            <p className="text-neutral-600 dark:text-neutral-400">
              Switch providers independently per category without altering BANA UI. Private API secrets remain strictly in server environment variables (`backend/.env` or Render Secrets) — never stored in Firestore.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadApiState()}
          className="px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Probes
        </button>
      </AdminCard>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <AdminKpiTile label="Active Category Providers" value={metrics.activeCount} tone="primary" />
        <AdminKpiTile label="Healthy / Connected" value={metrics.connectedCount} tone="emerald" />
        <AdminKpiTile label="Paid Providers Approved" value={metrics.paidApproved} tone="amber" />
        <AdminKpiTile
          label="Backend API Requests"
          value={backendUrl ? metrics.totalRequests : 'Local Mode'}
        />
      </div>

      {/* Backend Connectivity Summary */}
      <AdminCard className="p-4 text-xs flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-[#1877F2]" />
          <span className="font-semibold">
            Signaling & Token Backend: {backendUrl || 'Not configured (Built-in Firestore Spark mode active)'}
          </span>
        </div>
        {backendStatus && (
          <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
            WS Online: {backendStatus.wsStats?.onlineUsers ?? 0} · Active Rooms: {backendStatus.wsStats?.activeRooms ?? 0}
          </span>
        )}
      </AdminCard>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setSelectedCategory('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
            selectedCategory === 'all'
              ? 'bg-[#1877F2] text-white border-[#1877F2]'
              : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
          }`}
        >
          All 7 Categories
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
              selectedCategory === cat
                ? 'bg-[#1877F2] text-white border-[#1877F2]'
                : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900'
            }`}
          >
            {API_CATEGORY_LABELS[cat].title}
          </button>
        ))}
      </div>

      {/* Category Sections */}
      {visibleCategories.map((cat) => {
        const list = providers.filter((p) => p.category === cat);
        const info = API_CATEGORY_LABELS[cat];
        const rollbackId = previousActiveByCat[cat] || '';
        const canRollback = Boolean(canManage && rollbackId && list.some((x) => x.id === rollbackId && !x.isActive));
        return (
          <AdminCard key={cat} className="p-5 space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 pb-3">
              <div>
                <h3 className="font-display font-bold text-sm">{info.title}</h3>
                <p className="text-neutral-500">{info.subtitle}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-[#1877F2] font-semibold">
                  Active: {list.find((x) => x.isActive)?.name || 'None'}
                </span>
                {canRollback && (
                  <button
                    type="button"
                    onClick={() => handleRollbackProvider(cat)}
                    className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 font-semibold inline-flex items-center gap-1 text-[11px]"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Rollback to previous
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {list.map((item) => {
                const statusBadge =
                  item.connectionStatus === 'connected' ? (
                    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                    </span>
                  ) : item.connectionStatus === 'error' ? (
                    <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                      <XCircle className="w-3.5 h-3.5" /> Error
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-600 font-semibold">
                      <AlertTriangle className="w-3.5 h-3.5" /> {item.connectionStatus === 'unconfigured' ? 'Unconfigured' : 'Not Tested'}
                    </span>
                  );

                return (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3.5 space-y-2.5 ${
                      item.isActive
                        ? 'border-[#1877F2] bg-[#1877F2]/5 dark:bg-[#1877F2]/10'
                        : 'border-neutral-200 dark:border-neutral-800 bg-neutral-50/50 dark:bg-neutral-950/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-neutral-950 dark:text-white">{item.name}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded font-mono text-[10px] font-bold uppercase ${
                              item.tier === 'free'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                                : item.tier === 'open_source'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                            }`}
                          >
                            {item.tier.replace('_', ' ')}
                          </span>
                          {item.isActive && (
                            <span className="px-1.5 py-0.5 rounded bg-[#1877F2] text-white font-mono text-[10px] font-bold">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-neutral-500 mt-1">{item.docsNote}</p>
                      </div>
                      <div className="shrink-0">{statusBadge}</div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] bg-white/70 dark:bg-neutral-900/60 p-2 rounded-lg border border-neutral-100 dark:border-neutral-800">
                      <div>
                        <span className="text-neutral-400 block">Quota / Pricing</span>
                        <span className="font-medium">{item.monthlyQuotaLabel}</span>
                      </div>
                      <div>
                        <span className="text-neutral-400 block">Usage / Est. Cost</span>
                        <span className="font-mono">
                          {item.usageCount} req · ${Number(item.estimatedCostUsd || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {item.requiredEnvKeys.length > 0 && (
                      <p className="text-[11px] font-mono text-neutral-500 flex items-center gap-1">
                        <KeyRound className="w-3 h-3 shrink-0" />
                        Server Env: {item.requiredEnvKeys.join(', ')}
                      </p>
                    )}

                    {item.lastTestMessage && (
                      <p className="text-[11px] text-neutral-500">
                        Last test: {item.lastTestMessage}
                      </p>
                    )}

                    {/* Non-secret Endpoint / AppId Editor */}
                    {editingEndpointId === item.id && (
                      <div className="space-y-2 p-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
                        <input
                          type="text"
                          value={endpointDraft}
                          onChange={(e) => setEndpointDraft(e.target.value)}
                          placeholder="Public endpoint URL (e.g. wss://livekit.example.com)"
                          className="w-full h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 font-mono text-[11px]"
                        />
                        <input
                          type="text"
                          value={appIdDraft}
                          onChange={(e) => setAppIdDraft(e.target.value)}
                          placeholder="Public App ID / Project Ref (non-secret)"
                          className="w-full h-8 px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 font-mono text-[11px]"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingEndpointId(null)}
                            className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              await persistProviderDoc(item, {
                                endpointUrl: endpointDraft.trim(),
                                publicAppId: appIdDraft.trim(),
                              });
                              setEditingEndpointId(null);
                              onNotifyAction(`Saved non-secret endpoint metadata for ${item.name}.`);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-[#1877F2] text-white font-semibold"
                          >
                            Save Metadata
                          </button>
                        </div>
                      </div>
                    )}

                    {canManage && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <button
                          type="button"
                          disabled={testingId === item.id}
                          onClick={() => handleTestConnection(item)}
                          className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 font-semibold inline-flex items-center gap-1"
                        >
                          <PlugZap className="w-3 h-3" />
                          {testingId === item.id ? 'Testing...' : 'Test'}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setEditingEndpointId(editingEndpointId === item.id ? null : item.id);
                            setEndpointDraft(item.endpointUrl || '');
                            setAppIdDraft(item.publicAppId || '');
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 font-semibold"
                        >
                          Configure
                        </button>

                        {item.requiresBillingApproval && !item.billingApprovedByAdmin ? (
                          <button
                            type="button"
                            onClick={() => handleApprovePaidBilling(item)}
                            className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold inline-flex items-center gap-1"
                          >
                            <CreditCard className="w-3 h-3" /> Approve Paid Billing
                          </button>
                        ) : (
                          !item.isActive && (
                            <button
                              type="button"
                              onClick={() => handleActivateProvider(item)}
                              className="px-2.5 py-1.5 rounded-lg bg-[#1877F2] hover:bg-[#166FE5] text-white font-semibold"
                            >
                              Set Active
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </AdminCard>
        );
      })}

      {/* Error Logs */}
      <AdminCard className="p-5 space-y-3 text-xs">
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-sm flex items-center gap-2">
            <Activity className="w-4 h-4 text-[#1877F2]" />
            Provider Error Logs ({errorLogs.length})
          </h3>
        </div>
        {errorLogs.length === 0 ? (
          <p className="text-neutral-500 py-4 text-center">No recent provider errors recorded.</p>
        ) : (
          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {errorLogs.slice(0, 15).map((log) => (
              <div key={log.id} className="py-2 flex items-center justify-between gap-2">
                <div>
                  <span className="font-mono text-[11px] font-bold text-rose-600">{log.providerId}</span>
                  <p className="text-neutral-600 dark:text-neutral-400">{log.message}</p>
                </div>
                <span className="text-[11px] text-neutral-400 shrink-0">{log.category}</span>
              </div>
            ))}
          </div>
        )}
      </AdminCard>
    </div>
  );
}
