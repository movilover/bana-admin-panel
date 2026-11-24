import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, Search, Trash2, X } from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import { AdminCard, AdminPagination, AdminStateIndicator } from '@/src/components/admin/AdminShared';
import { isFunctionsFallbackError } from '@/src/lib/monetization';
import { moderateProductReview, reviewSellerApplication } from '@/src/lib/marketplace';
import {
  DEFAULT_PRODUCT_CATEGORIES,
  type BanaEvent,
  type BanaStore,
  type MarketplaceOrder,
  type PaymentGatewayStatus,
  type ProductCategoryItem,
  type ProductReview,
  type SellerApplication,
} from '@/src/types/bana';

interface AdminMarketplaceSectionProps {
  listings: any[];
  stores: BanaStore[];
  marketOrders: MarketplaceOrder[];
  productCategories: ProductCategoryItem[];
  gatewayStatus: PaymentGatewayStatus | null;
  gwCodEnabled: boolean;
  gwManualMobileEnabled: boolean;
  onSetGwCodEnabled: (v: boolean) => void;
  onSetGwManualMobileEnabled: (v: boolean) => void;
  canManageMarket: boolean;
  canManageFinance: boolean;
  sellerApplications?: SellerApplication[];
  productReviews?: ProductReview[];
  currentUid?: string;
  currentName?: string;
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
  onAskConfirm: (cfg: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    action: () => Promise<void>;
  }) => void;
}

const PAGE_SIZE = 10;

export function AdminMarketplaceSection({
  listings,
  stores,
  marketOrders,
  productCategories,
  gatewayStatus,
  gwCodEnabled,
  gwManualMobileEnabled,
  onSetGwCodEnabled,
  onSetGwManualMobileEnabled,
  canManageMarket,
  canManageFinance,
  sellerApplications = [],
  productReviews = [],
  currentUid = '',
  currentName = 'BANA Admin',
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: AdminMarketplaceSectionProps) {
  const [subTab, setSubTab] = useState<
    'products' | 'stores' | 'orders' | 'gateways' | 'categories' | 'applications' | 'reviews'
  >('products');
  const [appFilter, setAppFilter] = useState<'pending' | 'all'>('pending');
  const [appNotes, setAppNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<'all' | 'active' | 'hidden'>('all');
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const pendingApps = sellerApplications.filter((a) => a.status === 'pending');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'pending_review' | 'sold' | 'rejected'>('all');
  const [page, setPage] = useState(1);
  const [newCatName, setNewCatName] = useState('');
  const [newCatSubs, setNewCatSubs] = useState('');

  const filteredListings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return listings.filter((l) => {
      if (statusFilter !== 'all' && l.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(l.title || '').toLowerCase().includes(q) ||
        String(l.sellerUsername || '').toLowerCase().includes(q) ||
        String(l.category || '').toLowerCase().includes(q)
      );
    });
  }, [listings, search, statusFilter]);

  const pagedListings = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredListings.slice(start, start + PAGE_SIZE);
  }, [filteredListings, page]);

  const resolveOrderDispute = async (ord: MarketplaceOrder, resolution: 'refund' | 'dismiss_dispute') => {
    if (resolution === 'refund') {
      try {
        await invokeCloudFunction('adminResolveFinancialRefund', {
          targetType: 'marketplace_order',
          targetId: ord.id,
          reason: `Admin refund settlement on order #${ord.id}`,
        });
      } catch (err: any) {
        if (!isFunctionsFallbackError(err)) throw err;
        await updateDoc(doc(db, 'orders', ord.id), {
          status: 'refunded',
          paymentStatus: 'refunded',
          updatedAt: serverTimestamp(),
        });
        await onWriteAudit('order_refund', 'orders', ord.id, `Settled dispute & refunded order ${ord.id}`);
      }
    } else {
      await updateDoc(doc(db, 'orders', ord.id), {
        status: 'delivered',
        updatedAt: serverTimestamp(),
      });
      await onWriteAudit('order_dismiss_dispute', 'orders', ord.id, `Marked disputed order ${ord.id} delivered`);
    }
    onNotifyAction(`Order #${ord.id.slice(-8)} updated (${resolution}).`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'applications', label: `Seller Applications (${pendingApps.length} pending)` },
            { id: 'products', label: `Products (${listings.length})` },
            { id: 'stores', label: `Stores (${stores.length})` },
            { id: 'orders', label: `Orders & Disputes (${marketOrders.length})` },
            { id: 'gateways', label: 'Checkout Gateways' },
            { id: 'reviews', label: `Review Moderation (${productReviews.length})` },
            { id: 'categories', label: `Categories (${productCategories.length})` },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setSubTab(t.id);
              setPage(1);
            }}
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

      {subTab === 'products' && (
        <AdminCard className="p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display font-bold text-lg">Marketplace Listings ({filteredListings.length})</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Title, @seller, category..."
                  className="h-9 pl-8 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-xs"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value as any);
                  setPage(1);
                }}
                className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="pending_review">Pending Review</option>
                <option value="sold">Sold</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {pagedListings.map((l) => (
              <div key={l.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm">{l.title}</span>
                    <span className="font-mono font-semibold text-[#1877F2]">
                      {l.currency} {l.price}
                    </span>
                    <AdminStateIndicator status={l.status || 'active'} />
                  </div>
                  <p className="text-neutral-500">
                    Seller @{l.sellerUsername} · {l.category} · {l.location}
                  </p>
                </div>
                {canManageMarket && (
                  <div className="flex flex-wrap gap-1.5">
                    {l.status !== 'active' && (
                      <button
                        type="button"
                        onClick={async () => {
                          await updateDoc(doc(db, 'marketplaceListings', l.id), {
                            status: 'active',
                            updatedAt: serverTimestamp(),
                          });
                          await onWriteAudit('approve_listing', 'marketplaceListings', l.id, `Approved ${l.title}`);
                          onNotifyAction('Listing approved.');
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                      >
                        Approve
                      </button>
                    )}
                    {l.status !== 'rejected' && (
                      <button
                        type="button"
                        onClick={() =>
                          onAskConfirm({
                            title: 'Reject Marketplace Listing',
                            description: `Reject "${l.title}" from public catalog?`,
                            confirmLabel: 'Reject Listing',
                            variant: 'danger',
                            action: async () => {
                              await updateDoc(doc(db, 'marketplaceListings', l.id), {
                                status: 'rejected',
                                updatedAt: serverTimestamp(),
                              });
                              await onWriteAudit('reject_listing', 'marketplaceListings', l.id, `Rejected ${l.title}`);
                              onNotifyAction('Listing rejected.');
                            },
                          })
                        }
                        className="px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400 font-semibold"
                      >
                        Reject
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        onAskConfirm({
                          title: 'Delete Listing Permanently',
                          description: `Remove "${l.title}" permanently?`,
                          confirmLabel: 'Delete',
                          variant: 'danger',
                          action: async () => {
                            await deleteDoc(doc(db, 'marketplaceListings', l.id));
                            await onWriteAudit('delete_listing', 'marketplaceListings', l.id, `Deleted ${l.title}`);
                            onNotifyAction('Listing deleted.');
                          },
                        })
                      }
                      className="p-1.5 text-rose-600 rounded-lg"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <AdminPagination page={page} totalItems={filteredListings.length} pageSize={PAGE_SIZE} onPageChange={setPage} />
        </AdminCard>
      )}

      {subTab === 'stores' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">Seller Storefronts ({stores.length})</h2>
          {stores.length === 0 ? (
            <p className="text-neutral-500 py-6 text-center">No seller stores registered yet.</p>
          ) : (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {stores.map((st) => (
                <div key={st.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{st.name}</span>
                      <AdminStateIndicator status={st.status || 'active'} />
                    </div>
                    <p className="text-neutral-500">
                      Owner @{st.ownerUsername} · {st.district} · {st.totalSales || 0} sales
                    </p>
                  </div>
                  {canManageMarket && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          const next = st.status === 'active' ? 'suspended' : 'active';
                          await updateDoc(doc(db, 'stores', st.id), {
                            status: next,
                            updatedAt: serverTimestamp(),
                          });
                          await onWriteAudit('store_status', 'stores', st.id, `Set ${st.name} to ${next}`);
                          onNotifyAction(`Store marked ${next}.`);
                        }}
                        className="px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-400 font-semibold"
                      >
                        {st.status === 'active' ? 'Suspend' : 'Restore'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {subTab === 'orders' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display font-bold text-lg">Marketplace Orders & Disputes ({marketOrders.length})</h2>
            {!canManageFinance && (
              <span className="font-mono text-[11px] text-amber-600">
                Refund/dispute settlements require Super Admin or Finance Manager role.
              </span>
            )}
          </div>
          {marketOrders.length === 0 ? (
            <p className="text-neutral-500 py-6 text-center">No marketplace orders recorded yet.</p>
          ) : (
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {marketOrders.map((ord) => (
                <div key={ord.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold">#{ord.id.slice(-10)}</span>
                      <span className="font-mono font-semibold text-[#1877F2]">
                        {ord.currency} {ord.totalAmount}
                      </span>
                      <AdminStateIndicator status={ord.status} />
                    </div>
                    <p className="text-neutral-500">
                      Buyer @{ord.buyerUsername} → Seller @{ord.sellerUsername} · {ord.paymentMethod} · Payment:{' '}
                      {ord.paymentStatus}
                    </p>
                  </div>
                  {canManageFinance && ord.status !== 'refunded' && (
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          onAskConfirm({
                            title: 'Resolve Dispute with Full Refund',
                            description: `Mark order #${ord.id.slice(-8)} (${ord.currency} ${ord.totalAmount}) as refunded?`,
                            confirmLabel: 'Confirm Refund',
                            variant: 'danger',
                            action: () => resolveOrderDispute(ord, 'refund'),
                          })
                        }
                        className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold"
                      >
                        Issue Refund
                      </button>
                      <button
                        type="button"
                        onClick={() => resolveOrderDispute(ord, 'dismiss_dispute')}
                        className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 font-semibold"
                      >
                        Mark Completed
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {subTab === 'gateways' && (
        <AdminCard className="p-5 space-y-4 text-xs">
          <h2 className="font-display font-bold text-lg">Checkout & Payment Gateway Configuration</h2>
          <p className="text-neutral-500">
            Online payment gateways validate server-side environment secrets (`getPaymentGatewayConfigStatus`). Payment secrets are never saved in client bundles or Firestore.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800">
              <span>Cash on Delivery (COD)</span>
              <input
                type="checkbox"
                checked={gwCodEnabled}
                onChange={(e) => onSetGwCodEnabled(e.target.checked)}
                className="accent-[#1877F2]"
              />
            </label>
            <label className="flex items-center justify-between p-3 rounded-xl border border-neutral-200 dark:border-neutral-800">
              <span>Manual bKash / Nagad TrxID Verification</span>
              <input
                type="checkbox"
                checked={gwManualMobileEnabled}
                onChange={(e) => onSetGwManualMobileEnabled(e.target.checked)}
                className="accent-[#1877F2]"
              />
            </label>
          </div>
          {canManageMarket && (
            <button
              type="button"
              onClick={async () => {
                await setDoc(
                  doc(db, 'adminSettings', 'paymentGateways'),
                  {
                    codEnabled: gwCodEnabled,
                    manualMobileBankingEnabled: gwManualMobileEnabled,
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true }
                );
                await onWriteAudit('update_checkout_gateways', 'adminSettings', 'paymentGateways', 'Updated COD & Manual toggles');
                onNotifyAction('Checkout method toggles saved.');
              }}
              className="px-4 py-2 rounded-xl bg-[#1877F2] text-white font-semibold"
            >
              Save Checkout Toggles
            </button>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            {[
              { name: 'SSLCommerz', ok: gatewayStatus?.sslcommerzConfigured },
              { name: 'bKash Tokenized API', ok: gatewayStatus?.bkashGatewayConfigured },
              { name: 'Nagad Merchant API', ok: gatewayStatus?.nagadGatewayConfigured },
              { name: 'Stripe Cards', ok: gatewayStatus?.stripeConfigured },
            ].map((gw) => (
              <div key={gw.name} className="p-3 rounded-xl border border-neutral-200 dark:border-neutral-800">
                <p className="font-semibold">{gw.name}</p>
                <AdminStateIndicator
                  status={gw.ok ? 'connected' : 'pending'}
                  label={gw.ok ? 'Configured' : 'Env keys missing'}
                />
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {subTab === 'categories' && (
        <AdminCard className="p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display font-bold text-lg">Marketplace Categories & Subcategories</h2>
            {canManageMarket && (
              <button
                type="button"
                onClick={async () => {
                  await Promise.all(
                    DEFAULT_PRODUCT_CATEGORIES.map((dc) =>
                      setDoc(
                        doc(db, 'productCategories', dc.id),
                        { ...dc, createdAt: serverTimestamp(), updatedAt: serverTimestamp() },
                        { merge: true }
                      )
                    )
                  );
                  onNotifyAction('Default marketplace categories synced.');
                }}
                className="px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-700 font-semibold"
              >
                Seed Default Categories
              </button>
            )}
          </div>

          {canManageMarket && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!newCatName.trim()) return;
                const slug = newCatName
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, '-')
                  .replace(/(^-|-$)/g, '');
                const subs = newCatSubs
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean);
                await setDoc(doc(db, 'productCategories', slug || `cat-${Date.now()}`), {
                  name: newCatName.trim(),
                  slug: slug || `cat-${Date.now()}`,
                  subcategories: subs,
                  sortOrder: productCategories.length + 1,
                  isActive: true,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
                setNewCatName('');
                setNewCatSubs('');
                onNotifyAction('Product category added.');
              }}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2"
            >
              <input
                type="text"
                required
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category Name"
                className="sm:col-span-4 h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              />
              <input
                type="text"
                value={newCatSubs}
                onChange={(e) => setNewCatSubs(e.target.value)}
                placeholder="Subcategories (comma-separated)"
                className="sm:col-span-6 h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              />
              <button type="submit" className="sm:col-span-2 h-9 rounded-xl bg-[#1877F2] text-white font-semibold">
                Add
              </button>
            </form>
          )}

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {productCategories.map((cat) => (
              <div key={cat.id} className="py-2.5 flex items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">
                    #{cat.sortOrder} · {cat.name} {!cat.isActive && '(Disabled)'}
                  </p>
                  <p className="text-neutral-500">Subcategories: {(cat.subcategories || []).join(', ') || 'None'}</p>
                </div>
                {canManageMarket && (
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={async () => {
                        await setDoc(
                          doc(db, 'productCategories', cat.id),
                          { ...cat, isActive: !cat.isActive, updatedAt: serverTimestamp() },
                          { merge: true }
                        );
                        onNotifyAction(`Category ${cat.isActive ? 'disabled' : 'enabled'}.`);
                      }}
                      className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
                    >
                      {cat.isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteDoc(doc(db, 'productCategories', cat.id));
                        onNotifyAction('Category deleted.');
                      }}
                      className="p-1.5 text-rose-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {subTab === 'applications' && (
        <AdminCard className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display font-bold text-base">Seller Applications</h2>
            <select
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value as 'pending' | 'all')}
              className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 text-xs"
            >
              <option value="pending">Pending only</option>
              <option value="all">All decisions</option>
            </select>
          </div>
          {(appFilter === 'pending' ? pendingApps : sellerApplications).length === 0 ? (
            <p className="text-xs text-neutral-500 py-6 text-center">No seller applications to show.</p>
          ) : (
            <div className="space-y-3">
              {(appFilter === 'pending' ? pendingApps : sellerApplications).map((a) => (
                <div key={a.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-sm">{a.storeName}</p>
                      <p className="text-neutral-500">
                        @{a.username} · {a.displayName} · {a.district} · {a.businessType === 'registered_business' ? 'Registered business' : 'Individual'}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded-full font-semibold ${
                        a.status === 'approved'
                          ? 'bg-emerald-100 text-emerald-700'
                          : a.status === 'rejected'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {a.status}
                    </span>
                  </div>
                  <p className="text-neutral-700 dark:text-neutral-300">{a.storeDescription}</p>
                  {a.productCategories?.length > 0 && (
                    <p className="text-neutral-500">Categories: {a.productCategories.join(', ')}</p>
                  )}
                  {(a.contactPhone || a.contactEmail) && (
                    <p className="text-neutral-500">Contact: {[a.contactPhone, a.contactEmail].filter(Boolean).join(' · ')}</p>
                  )}
                  {a.status !== 'pending' && a.adminNote && <p className="text-neutral-500">Reviewer note: {a.adminNote}</p>}
                  {a.status === 'pending' && canManageMarket && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        value={appNotes[a.id] || ''}
                        onChange={(e) => setAppNotes((n) => ({ ...n, [a.id]: e.target.value }))}
                        placeholder="Decision note (required for rejection)"
                        className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                      />
                      {(['approved', 'rejected'] as const).map((decision) => (
                        <button
                          key={decision}
                          type="button"
                          disabled={busyId === a.id}
                          onClick={async () => {
                            setBusyId(a.id);
                            try {
                              await reviewSellerApplication({
                                application: a,
                                decision,
                                adminUid: currentUid,
                                adminName: currentName,
                                note: appNotes[a.id] || '',
                              });
                              await onWriteAudit(`seller_application_${decision}`, 'sellerApplications', a.id, `Seller application for @${a.username} ${decision}`);
                              onNotifyAction(`Seller application ${decision}.`);
                            } catch (err: any) {
                              onNotifyAction(err?.message || 'Decision failed.');
                            } finally {
                              setBusyId(null);
                            }
                          }}
                          className={`px-3 h-9 rounded-lg font-semibold text-white disabled:opacity-50 ${
                            decision === 'approved' ? 'bg-emerald-600' : 'bg-rose-600'
                          }`}
                        >
                          {decision === 'approved' ? 'Approve' : 'Reject'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      )}

      {subTab === 'reviews' && (
        <AdminCard className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display font-bold text-base">Product Review Moderation</h2>
            <select
              value={reviewFilter}
              onChange={(e) => setReviewFilter(e.target.value as 'all' | 'active' | 'hidden')}
              className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2 text-xs"
            >
              <option value="all">All reviews</option>
              <option value="active">Visible</option>
              <option value="hidden">Hidden</option>
            </select>
          </div>
          {productReviews.filter((r) => reviewFilter === 'all' || r.status === reviewFilter).length === 0 ? (
            <p className="text-xs text-neutral-500 py-6 text-center">No reviews match this filter.</p>
          ) : (
            <div className="space-y-2">
              {productReviews
                .filter((r) => reviewFilter === 'all' || r.status === reviewFilter)
                .map((r) => (
                  <div key={r.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 text-xs space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">
                        {'★'.repeat(Math.max(0, Math.round(r.rating)))}{' '}
                        <span className="text-neutral-500 font-normal">
                          @{r.reviewerUsername} · product {r.productId.slice(-6)} {r.isVerifiedPurchase ? '· verified purchase' : ''}
                        </span>
                      </p>
                      <span className={`px-2 py-0.5 rounded-full font-semibold ${r.status === 'hidden' ? 'bg-neutral-200 text-neutral-700' : 'bg-emerald-100 text-emerald-700'}`}>
                        {r.status === 'hidden' ? 'hidden' : 'visible'}
                      </span>
                    </div>
                    <p className="text-neutral-700 dark:text-neutral-300">{r.comment}</p>
                    {canManageMarket && (
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          value={reviewNotes[r.id] || ''}
                          onChange={(e) => setReviewNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                          placeholder="Moderation note (optional)"
                          className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                        />
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() =>
                            onAskConfirm({
                              title: r.status === 'hidden' ? 'Restore review?' : 'Hide review?',
                              description:
                                r.status === 'hidden'
                                  ? 'The review becomes publicly visible again and rating aggregates are recomputed.'
                                  : 'The review is hidden from the public (not deleted) and rating aggregates are recomputed.',
                              confirmLabel: r.status === 'hidden' ? 'Restore' : 'Hide',
                              action: async () => {
                                setBusyId(r.id);
                                try {
                                  const next = r.status === 'hidden' ? 'active' : 'hidden';
                                  await moderateProductReview({
                                    review: r,
                                    nextStatus: next,
                                    adminUid: currentUid,
                                    adminName: currentName,
                                    note: reviewNotes[r.id],
                                  });
                                  await onWriteAudit(`review_${next === 'hidden' ? 'hide' : 'restore'}`, 'productReviews', r.id, `Review ${r.id} set to ${next}`);
                                  onNotifyAction(`Review ${next === 'hidden' ? 'hidden' : 'restored'}.`);
                                } finally {
                                  setBusyId(null);
                                }
                              },
                            })
                          }
                          className="px-3 h-9 rounded-lg border border-neutral-300 dark:border-neutral-700 font-semibold disabled:opacity-50"
                        >
                          {r.status === 'hidden' ? 'Restore' : 'Hide'}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
            </div>
          )}
        </AdminCard>
      )}
    </div>
  );
}

interface AdminCommunitiesSectionProps {
  communities: any[];
  events: BanaEvent[];
  users: any[];
  marketReports: any[];
  canManageCommunities: boolean;
  canTransferOwner: boolean;
  onWriteAudit: (action: string, targetType: string, targetId: string, summary: string) => Promise<void>;
  onNotifyAction: (msg: string) => void;
  onAskConfirm: (cfg: {
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'danger' | 'primary';
    action: () => Promise<void>;
  }) => void;
}

export function AdminCommunitiesSection({
  communities,
  events,
  users,
  marketReports,
  canManageCommunities,
  canTransferOwner,
  onWriteAudit,
  onNotifyAction,
  onAskConfirm,
}: AdminCommunitiesSectionProps) {
  const [tab, setTab] = useState<'groups' | 'events' | 'reports'>('groups');
  const [reportNotes, setReportNotes] = useState<Record<string, string>>({});
  const [reportBusy, setReportBusy] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [transferGroup, setTransferGroup] = useState<any | null>(null);
  const [newOwnerUid, setNewOwnerUid] = useState('');
  const [transferReason, setTransferReason] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return communities.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        String(c.name || '').toLowerCase().includes(q) ||
        String(c.category || '').toLowerCase().includes(q) ||
        String(c.district || '').toLowerCase().includes(q)
      );
    });
  }, [communities, search, statusFilter]);

  const commReports = useMemo(
    () => marketReports.filter((mr) => ['community', 'event', 'community_member', 'community_post'].includes(mr.targetType)),
    [marketReports]
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'groups', label: `Groups (${communities.length})` },
            { id: 'events', label: `Events (${events.length})` },
            { id: 'reports', label: `Community Reports (${commReports.length})` },
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

      {tab === 'groups' && (
        <AdminCard className="p-5 space-y-4 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display font-bold text-lg">Communities & Groups ({filtered.length})</h2>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, category, district..."
                  className="h-9 pl-8 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 text-xs"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {filtered.map((c) => (
              <div key={c.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm">{c.name}</span>
                    <span className="font-mono text-[11px] text-neutral-500">({c.privacy})</span>
                    <AdminStateIndicator status={c.status || 'active'} />
                  </div>
                  <p className="text-neutral-500">
                    {c.category} {c.district ? `· ${c.district}` : ''} · {c.membersCount || 0} members · Owner UID:{' '}
                    <span className="font-mono">{c.creatorId}</span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {canTransferOwner && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewOwnerUid('');
                        setTransferReason('');
                        setTransferGroup(c);
                      }}
                      className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 font-semibold inline-flex items-center gap-1"
                    >
                      <ArrowRightLeft className="w-3 h-3" /> Transfer Ownership
                    </button>
                  )}
                  {canManageCommunities && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = c.status === 'active' ? 'suspended' : 'active';
                        onAskConfirm({
                          title: next === 'suspended' ? 'Suspend Community' : 'Restore Community',
                          description: `Set "${c.name}" status to ${next}?`,
                          confirmLabel: next === 'suspended' ? 'Suspend' : 'Restore',
                          variant: next === 'suspended' ? 'danger' : 'primary',
                          action: async () => {
                            await updateDoc(doc(db, 'communities', c.id), {
                              status: next,
                              updatedAt: serverTimestamp(),
                            });
                            await onWriteAudit('community_status', 'communities', c.id, `Set ${c.name} to ${next}`);
                            onNotifyAction(`Community marked ${next}.`);
                          },
                        });
                      }}
                      className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 font-semibold"
                    >
                      {c.status === 'active' ? 'Suspend' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      {tab === 'events' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">Community & Local Events ({events.length})</h2>
          {events.map((ev) => (
            <div key={ev.id} className="py-2.5 border-b border-neutral-100 dark:border-neutral-800 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{ev.title}</p>
                <p className="text-neutral-500">
                  {ev.eventDate} · {ev.district} · {ev.attendeesCount} going · Status: {ev.status}
                </p>
              </div>
              {canManageCommunities && (
                <div className="flex gap-1.5">
                  {ev.status === 'upcoming' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await updateDoc(doc(db, 'events', ev.id), { status: 'cancelled' });
                        await onWriteAudit('cancel_event', 'events', ev.id, `Cancelled event ${ev.title}`);
                        onNotifyAction('Event cancelled.');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-amber-600 text-white font-semibold"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteDoc(doc(db, 'events', ev.id));
                      await onWriteAudit('delete_event', 'events', ev.id, `Deleted event ${ev.title}`);
                      onNotifyAction('Event deleted.');
                    }}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-semibold"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </AdminCard>
      )}

      {tab === 'reports' && (
        <AdminCard className="p-5 space-y-3 text-xs">
          <h2 className="font-display font-bold text-lg">Community, Post & Event Reports ({commReports.length})</h2>
          {commReports.length === 0 ? (
            <p className="text-neutral-500 py-6 text-center">No community reports in queue.</p>
          ) : (
            commReports.map((mr) => {
              const decide = async (status: 'resolved' | 'dismissed', removePost = false) => {
                setReportBusy(mr.id);
                try {
                  const note = (reportNotes[mr.id] || '').trim();
                  if (removePost && mr.communityId) {
                    // Explicit admin decision: the post is soft-removed (status flag), never hard-deleted.
                    await updateDoc(doc(db, 'communities', mr.communityId, 'posts', mr.targetId), {
                      status: 'removed',
                      updatedAt: serverTimestamp(),
                    });
                    await onWriteAudit('community_post_removed', 'communityPost', mr.targetId, `Removed post ${mr.targetId} in ${mr.communityId} (report ${mr.id}): ${note || mr.reason}`);
                  }
                  await updateDoc(doc(db, 'marketplaceReports', mr.id), {
                    status,
                    resolutionNote: removePost ? `Post removed. ${note}`.trim() : note,
                    updatedAt: serverTimestamp(),
                  });
                  await onWriteAudit(`community_report_${status}`, 'marketplaceReports', mr.id, `${mr.targetType} report ${status}${note ? ': ' + note : ''}`);
                  onNotifyAction(removePost ? 'Post removed and report resolved.' : `Report ${status}.`);
                } catch (err: any) {
                  onNotifyAction(err?.message || 'Action failed.');
                } finally {
                  setReportBusy(null);
                }
              };
              return (
                <div key={mr.id} className="py-2.5 border-b border-neutral-100 dark:border-neutral-800 space-y-2">
                  <div>
                    <p className="font-semibold">
                      [{mr.targetType}] {mr.reason} · <AdminStateIndicator status={mr.status} />
                    </p>
                    <p className="text-neutral-500">{mr.details || mr.targetId}</p>
                    {mr.communityId && <p className="text-neutral-400">Group: {mr.communityId}</p>}
                    {mr.resolutionNote && <p className="text-neutral-500">Decision: {mr.resolutionNote}</p>}
                  </div>
                  {mr.status === 'pending' && canManageCommunities && (
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        value={reportNotes[mr.id] || ''}
                        onChange={(e) => setReportNotes((n) => ({ ...n, [mr.id]: e.target.value }))}
                        placeholder="Decision note"
                        className="flex-1 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
                      />
                      {mr.targetType === 'community_post' && mr.communityId && (
                        <button
                          type="button"
                          disabled={reportBusy === mr.id}
                          onClick={() =>
                            onAskConfirm({
                              title: 'Remove reported post?',
                              description: 'The post is hidden from the group (soft-removed, not deleted) and this report is resolved.',
                              confirmLabel: 'Remove post',
                              variant: 'danger',
                              action: () => decide('resolved', true),
                            })
                          }
                          className="px-3 h-9 rounded-lg bg-rose-600 text-white font-semibold disabled:opacity-50"
                        >
                          Remove post
                        </button>
                      )}
                      <button type="button" disabled={reportBusy === mr.id} onClick={() => decide('resolved')} className="px-3 h-9 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50">
                        Resolve
                      </button>
                      <button type="button" disabled={reportBusy === mr.id} onClick={() => decide('dismissed')} className="px-3 h-9 rounded-lg border border-neutral-300 dark:border-neutral-700 font-semibold disabled:opacity-50">
                        Dismiss
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </AdminCard>
      )}

      {/* Community Ownership Dispute Transfer Modal */}
      {transferGroup && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <div>
                <h3 className="font-display font-bold text-base">Transfer Group Ownership</h3>
                <p className="text-neutral-500">{transferGroup.name}</p>
              </div>
              <button type="button" onClick={() => setTransferGroup(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5">
              <div className="space-y-1">
                <label className="font-medium block">Select Registered New Owner</label>
                <select
                  value=""
                  onChange={(e) => setNewOwnerUid(e.target.value)}
                  className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3"
                >
                  <option value="">Choose user account...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.displayName} (@{u.username})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="font-medium block">Or Enter New Owner UID</label>
                <input
                  type="text"
                  value={newOwnerUid}
                  onChange={(e) => setNewOwnerUid(e.target.value)}
                  placeholder="Target Firebase UID"
                  className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 font-mono"
                />
              </div>
              <div className="space-y-1">
                <label className="font-medium block">Dispute / Governance Reason</label>
                <input
                  type="text"
                  value={transferReason}
                  onChange={(e) => setTransferReason(e.target.value)}
                  placeholder="Verified ownership dispute resolution..."
                  className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
              <button
                type="button"
                onClick={() => setTransferGroup(null)}
                className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newOwnerUid.trim()}
                onClick={async () => {
                  const targetOwner = newOwnerUid.trim();
                  if (!targetOwner) return;
                  try {
                    await invokeCloudFunction('adminTransferCommunityOwnership', {
                      communityId: transferGroup.id,
                      newOwnerUid: targetOwner,
                      reason: transferReason.trim() || 'Ownership transferred by administration',
                    });
                  } catch (err: any) {
                    if (!isFunctionsFallbackError(err)) throw err;
                    await updateDoc(doc(db, 'communities', transferGroup.id), {
                      creatorId: targetOwner,
                      updatedAt: serverTimestamp(),
                    });
                    await onWriteAudit(
                      'transfer_community_ownership',
                      'communities',
                      transferGroup.id,
                      `Transferred ${transferGroup.name} ownership to ${targetOwner}`
                    );
                  }
                  setTransferGroup(null);
                  onNotifyAction(`Transferred "${transferGroup.name}" ownership.`);
                }}
                className="px-4 py-2 rounded-xl bg-[#1877F2] text-white font-semibold disabled:opacity-50"
              >
                Confirm Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
