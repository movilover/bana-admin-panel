import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import {
  DEFAULT_PRODUCT_CATEGORIES,
  type BanaMarketListing,
  type BanaStore,
  type BanaUser,
  type CartItem,
  type MarketplaceOrder,
  type MarketplacePayment,
  type OrderPaymentMethod,
  type OrderShippingAddress,
  type OrderStatus,
  type PaymentGatewayStatus,
  type ProductCategoryItem,
  type ProductReview,
  type SellerApplication,
} from '@/src/types/bana';
import { logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';

const GUEST_CART_KEY = 'bana_guest_cart_v1';
const RECENTLY_VIEWED_KEY = 'bana_market_recent_v1';

export function getRecentlyViewedIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function trackRecentlyViewedProduct(productId: string) {
  try {
    const prev = getRecentlyViewedIds().filter((id) => id !== productId);
    const next = [productId, ...prev].slice(0, 12);
    localStorage.setItem(RECENTLY_VIEWED_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors
  }
}

export async function fetchProductCategories(includeInactive = false): Promise<ProductCategoryItem[]> {
  try {
    const snap = await getDocs(query(collection(db, 'productCategories'), orderBy('sortOrder', 'asc'), limit(50)));
    if (!snap.empty) {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductCategoryItem, 'id'>) }));
      return includeInactive ? list : list.filter((c) => c.isActive !== false);
    }
  } catch {
    // Fall back to default categories if collection isn't populated or indexed yet
  }
  return DEFAULT_PRODUCT_CATEGORIES;
}

export async function fetchActiveStores(limitCount = 24): Promise<BanaStore[]> {
  try {
    const { items } = await getDocsWithIndexFallback<BanaStore>(
      query(collection(db, 'stores'), where('status', '==', 'active'), orderBy('ratingAvg', 'desc'), limit(limitCount)),
      query(collection(db, 'stores'), where('status', '==', 'active'), limit(Math.max(limitCount, 40))),
      (a, b) => Number(b.ratingAvg || 0) - Number(a.ratingAvg || 0)
    );
    return items.slice(0, limitCount);
  } catch {
    return [];
  }
}

export async function fetchMyStore(uid: string): Promise<BanaStore | null> {
  const direct = await getDoc(doc(db, 'stores', uid)).catch(() => null);
  if (direct?.exists()) {
    return { id: direct.id, ...(direct.data() as Omit<BanaStore, 'id'>) };
  }
  const snap = await getDocs(query(collection(db, 'stores'), where('ownerId', '==', uid), limit(1))).catch(() => null);
  if (snap && !snap.empty) {
    const d = snap.docs[0];
    return { id: d.id, ...(d.data() as Omit<BanaStore, 'id'>) };
  }
  return null;
}

export async function saveSellerStore(
  profile: BanaUser,
  payload: {
    name: string;
    description: string;
    district: string;
    contactPreference: 'messenger' | 'phone' | 'both';
    contactPhone?: string;
    contactEmail?: string;
    logoUrl?: string;
    coverUrl?: string;
  },
  existingStore?: BanaStore | null
): Promise<BanaStore> {
  const storeId = existingStore?.id || profile.uid;
  const slug =
    payload.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `store-${profile.uid.slice(0, 6)}`;

  if (existingStore) {
    await updateDoc(doc(db, 'stores', storeId), {
      name: payload.name.trim(),
      slug,
      description: payload.description.trim(),
      district: payload.district.trim(),
      contactPreference: payload.contactPreference,
      contactPhone: (payload.contactPhone || '').trim(),
      contactEmail: (payload.contactEmail || '').trim(),
      ...(payload.logoUrl !== undefined ? { logoUrl: payload.logoUrl } : {}),
      ...(payload.coverUrl !== undefined ? { coverUrl: payload.coverUrl } : {}),
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(doc(db, 'stores', storeId), {
      ownerId: profile.uid,
      ownerUsername: profile.username,
      ownerName: profile.displayName,
      name: payload.name.trim(),
      slug,
      description: payload.description.trim(),
      logoUrl: payload.logoUrl || profile.avatarUrl || '',
      coverUrl: payload.coverUrl || profile.coverUrl || '',
      district: payload.district.trim() || 'Dhaka',
      contactPreference: payload.contactPreference,
      contactPhone: (payload.contactPhone || '').trim(),
      contactEmail: (payload.contactEmail || '').trim(),
      ratingAvg: 0,
      reviewsCount: 0,
      totalSales: 0,
      status: 'active',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  const updated = await getDoc(doc(db, 'stores', storeId));
  return { id: updated.id, ...(updated.data() as Omit<BanaStore, 'id'>) };
}

// =========================================================================
// Shopping Cart & Wishlist
// =========================================================================
export function readGuestCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(GUEST_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function writeGuestCart(items: CartItem[]) {
  try {
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(items));
  } catch {
    // Ignore
  }
}

export async function loadUserCart(uid: string): Promise<CartItem[]> {
  try {
    const snap = await getDoc(doc(db, 'shoppingCarts', uid));
    const remote: CartItem[] = snap.exists() && Array.isArray(snap.data()?.items) ? snap.data()!.items : [];
    const guest = readGuestCart();
    if (guest.length > 0) {
      const merged = [...remote];
      for (const g of guest) {
        if (g.sellerId === uid) continue;
        const idx = merged.findIndex((m) => m.productId === g.productId);
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], quantity: Math.min(merged[idx].quantity + g.quantity, 50) };
        } else {
          merged.push(g);
        }
      }
      await saveUserCart(uid, merged);
      writeGuestCart([]);
      return merged;
    }
    return remote;
  } catch (err) {
    logFirestoreError(err, OperationType.GET, `shoppingCarts/${uid}`);
    return [];
  }
}

export async function saveUserCart(uid: string | null | undefined, items: CartItem[]): Promise<void> {
  if (!uid) {
    writeGuestCart(items);
    return;
  }
  await setDoc(doc(db, 'shoppingCarts', uid), {
    uid,
    items: items.slice(0, 50),
    updatedAt: serverTimestamp(),
  });
}

export async function fetchWishlistIds(uid: string): Promise<string[]> {
  try {
    const snap = await getDocs(query(collection(db, 'wishlists'), where('userId', '==', uid), limit(100)));
    return snap.docs.map((d) => String(d.data().productId));
  } catch {
    return [];
  }
}

export async function toggleProductWishlist(uid: string, productId: string, currentlyWished: boolean): Promise<boolean> {
  const docId = `${uid}_${productId}`;
  if (currentlyWished) {
    await deleteDoc(doc(db, 'wishlists', docId));
    return false;
  }
  await setDoc(doc(db, 'wishlists', docId), {
    userId: uid,
    productId,
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'marketplaceListings', productId), { savesCount: increment(1) }).catch(() => {});
  return true;
}

// =========================================================================
// Payment Gateway Status & Trusted Order Creation / Transitions
// =========================================================================
export async function fetchPaymentGatewayStatus(): Promise<PaymentGatewayStatus> {
  try {
    return await invokeCloudFunction<void, PaymentGatewayStatus>('getPaymentGatewayConfigStatus');
  } catch {
    const gwSnap = await getDoc(doc(db, 'adminSettings', 'paymentGateways')).catch(() => null);
    const cfg = gwSnap?.exists() ? gwSnap.data() || {} : {};
    return {
      codEnabled: cfg.codEnabled !== false,
      manualMobileBankingEnabled: cfg.manualMobileBankingEnabled !== false,
      sslcommerzConfigured: Boolean(cfg.sslcommerzEnabled),
      bkashGatewayConfigured: Boolean(cfg.bkashGatewayEnabled),
      nagadGatewayConfigured: Boolean(cfg.nagadGatewayEnabled),
      stripeConfigured: Boolean(cfg.stripeEnabled),
      requiredEnvKeys: [
        'SSLCOMMERZ_STORE_ID',
        'SSLCOMMERZ_STORE_PASS',
        'BKASH_APP_KEY',
        'BKASH_APP_SECRET',
        'NAGAD_MERCHANT_ID',
        'NAGAD_PRIVATE_KEY',
        'STRIPE_SECRET_KEY',
        'STRIPE_WEBHOOK_SECRET',
      ],
    };
  }
}

export async function placeMarketplaceOrder(params: {
  buyerProfile: BanaUser;
  idempotencyKey: string;
  items: CartItem[];
  shippingAddress: OrderShippingAddress;
  paymentMethod: OrderPaymentMethod;
  deliveryOption: string;
  paymentRef?: string;
  senderAccount?: string;
}): Promise<{ orderIds: string[]; usedServerFn: boolean }> {
  const payload = {
    idempotencyKey: params.idempotencyKey,
    items: params.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
    shippingAddress: params.shippingAddress,
    paymentMethod: params.paymentMethod,
    deliveryOption: params.deliveryOption,
    paymentRef: params.paymentRef || '',
    senderAccount: params.senderAccount || '',
  };

  try {
    const data = await invokeCloudFunction<typeof payload, { ok: boolean; orderIds: string[] }>(
      'createMarketplaceOrder',
      payload
    );
    return { orderIds: data.orderIds || [], usedServerFn: true };
  } catch (err: any) {
    // Only fall back cleanly when Cloud Functions are unavailable in preview/not deployed yet;
    // reject real validation/precondition errors directly.
    const code = String(err?.code || '');
    const msg = String(err?.message || '');
    const isFnUnavailable =
      code.includes('not-found') ||
      code.includes('unavailable') ||
      code.includes('internal') ||
      msg.toLowerCase().includes('cors') ||
      msg.toLowerCase().includes('network');

    if (!isFnUnavailable) {
      throw err;
    }

    if (params.paymentMethod === 'card_gateway') {
      throw new Error(
        'Online card gateway is not configured on the server yet. Select Cash on Delivery (COD) or bKash/Nagad verification.'
      );
    }

    // Fallback transactional order creation that NEVER trusts browser cart totals:
    // re-reads authoritative price & stock from Firestore `marketplaceListings` inside runTransaction.
    const uid = params.buyerProfile.uid;
    const dupSnap = await getDocs(
      query(
        collection(db, 'orders'),
        where('buyerId', '==', uid),
        where('idempotencyKey', '==', params.idempotencyKey),
        limit(10)
      )
    );
    if (!dupSnap.empty) {
      return { orderIds: dupSnap.docs.map((d) => d.id), usedServerFn: false };
    }

    const checkoutGroupId = `chk_${Date.now()}_${uid.slice(0, 6)}`;
    const createdOrderIds: string[] = [];

    await runTransaction(db, async (tx) => {
      const snaps = await Promise.all(
        params.items.map((i) => tx.get(doc(db, 'marketplaceListings', i.productId)))
      );

      const bySeller = new Map<
        string,
        Array<{
          product: BanaMarketListing;
          requestedQty: number;
          currentQty: number;
        }>
      >();

      for (let idx = 0; idx < snaps.length; idx++) {
        const snap = snaps[idx];
        const reqItem = params.items[idx];
        if (!snap.exists()) throw new Error(`Product "${reqItem.title}" is no longer available.`);
        const prod = { id: snap.id, ...(snap.data() as Omit<BanaMarketListing, 'id'>) };
        const currentQty = typeof prod.quantity === 'number' ? prod.quantity : prod.status === 'active' ? 1 : 0;

        if (prod.status !== 'active') throw new Error(`"${prod.title}" is no longer active.`);
        if (prod.sellerId === uid) throw new Error(`Cannot purchase your own listing ("${prod.title}").`);
        if (currentQty < reqItem.quantity) {
          throw new Error(`Insufficient stock for "${prod.title}" (available: ${currentQty}).`);
        }

        const arr = bySeller.get(prod.sellerId) || [];
        arr.push({ product: prod, requestedQty: reqItem.quantity, currentQty });
        bySeller.set(prod.sellerId, arr);
      }

      let sellerIdx = 0;
      for (const [sellerId, lines] of bySeller.entries()) {
        sellerIdx++;
        const orderId = `${params.idempotencyKey}_s${sellerIdx}`.slice(0, 120);
        const orderRef = doc(db, 'orders', orderId);
        const subtotal = lines.reduce((sum, l) => sum + Number(l.product.price) * l.requestedQty, 0);
        const deliveryFee =
          params.deliveryOption === 'Local Pickup'
            ? 0
            : lines.reduce((m, l) => Math.max(m, Number(l.product.deliveryFee || 0)), 0);
        const totalAmount = subtotal + deliveryFee;
        const currency = lines[0].product.currency || 'BDT';
        const paymentStatus = params.paymentMethod === 'cod' ? 'pending_cod' : 'awaiting_verification';

        tx.set(orderRef, {
          checkoutGroupId,
          idempotencyKey: params.idempotencyKey,
          buyerId: uid,
          buyerName: params.buyerProfile.displayName,
          buyerUsername: params.buyerProfile.username,
          sellerId,
          sellerName: lines[0].product.sellerName,
          sellerUsername: lines[0].product.sellerUsername,
          storeId: lines[0].product.storeId || '',
          storeName: lines[0].product.storeName || '',
          itemsSnapshot: lines.map((l) => ({
            productId: l.product.id,
            title: l.product.title,
            imageUrl: l.product.imageUrls?.[0] || '',
            unitPrice: Number(l.product.price),
            quantity: l.requestedQty,
            lineTotal: Number(l.product.price) * l.requestedQty,
          })),
          itemProductIds: lines.map((l) => l.product.id),
          subtotal,
          deliveryFee,
          totalAmount,
          currency,
          deliveryOption: params.deliveryOption,
          shippingAddress: params.shippingAddress,
          paymentMethod: params.paymentMethod,
          paymentStatus,
          paymentRef: (params.paymentRef || '').trim(),
          status: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        lines.forEach((l, lineIdx) => {
          const oiRef = doc(db, 'orderItems', `${orderId}_${lineIdx}`);
          tx.set(oiRef, {
            orderId,
            buyerId: uid,
            sellerId,
            storeId: l.product.storeId || '',
            productId: l.product.id,
            title: l.product.title,
            imageUrl: l.product.imageUrls?.[0] || '',
            unitPrice: Number(l.product.price),
            quantity: l.requestedQty,
            lineTotal: Number(l.product.price) * l.requestedQty,
            currency,
            createdAt: serverTimestamp(),
          });

          const nextQty = Math.max(0, l.currentQty - l.requestedQty);
          tx.update(doc(db, 'marketplaceListings', l.product.id), {
            quantity: nextQty,
            soldCount: Number(l.product.soldCount || 0) + l.requestedQty,
            status: nextQty === 0 ? 'out_of_stock' : 'active',
            updatedAt: serverTimestamp(),
          });
        });

        tx.set(doc(db, 'payments', `pay_${orderId}`), {
          orderId,
          buyerId: uid,
          sellerId,
          amount: totalAmount,
          currency,
          method: params.paymentMethod,
          transactionRef:
            (params.paymentRef || '').trim() || (params.paymentMethod === 'cod' ? `COD-${orderId.slice(-8)}` : ''),
          senderAccount: (params.senderAccount || '').trim(),
          providerVerified: false,
          status: paymentStatus,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        createdOrderIds.push(orderId);
      }
    });

    // Clear ordered items from persisted cart & notify sellers
    const orderedProductIds = new Set(params.items.map((i) => i.productId));
    const currentCart = await loadUserCart(uid);
    await saveUserCart(
      uid,
      currentCart.filter((c) => !orderedProductIds.has(c.productId))
    );

    const uniqueSellers = Array.from(new Set(params.items.map((i) => i.sellerId)));
    await Promise.all(
      uniqueSellers.map((sid, idx) =>
        addDoc(collection(db, 'notifications'), {
          recipientId: sid,
          actorId: uid,
          actorName: params.buyerProfile.displayName,
          actorAvatar: params.buyerProfile.avatarUrl || '',
          type: 'marketplace',
          title: 'New Marketplace Order',
          body: `${params.buyerProfile.displayName} placed a new order in your store.`,
          linkUrl: '/market?tab=seller',
          dedupeKey: `order_fb_${createdOrderIds[idx] || params.idempotencyKey}_${sid}`,
          isRead: false,
          createdAt: serverTimestamp(),
        }).catch(() => {})
      )
    );

    return { orderIds: createdOrderIds, usedServerFn: false };
  }
}

export async function updateMarketplaceOrderStatus(params: {
  order: MarketplaceOrder;
  actorUid: string;
  actorName: string;
  nextStatus: OrderStatus;
  trackingCode?: string;
  note?: string;
}): Promise<void> {
  try {
    await invokeCloudFunction('transitionOrderStatus', {
      orderId: params.order.id,
      nextStatus: params.nextStatus,
      trackingCode: params.trackingCode || '',
      note: params.note || '',
    });
    return;
  } catch (err: any) {
    const code = String(err?.code || '');
    const msg = String(err?.message || '');
    const isFnUnavailable =
      code.includes('not-found') ||
      code.includes('unavailable') ||
      code.includes('internal') ||
      msg.toLowerCase().includes('cors') ||
      msg.toLowerCase().includes('network');
    if (!isFnUnavailable) throw err;
  }

  await updateDoc(doc(db, 'orders', params.order.id), {
    status: params.nextStatus,
    ...(params.trackingCode ? { trackingCode: params.trackingCode.trim() } : {}),
    ...(params.nextStatus === 'cancelled'
      ? { cancelReason: params.note || 'Cancelled' }
      : params.note
      ? { sellerNote: params.note }
      : {}),
    updatedAt: serverTimestamp(),
  });

  if (
    params.nextStatus === 'cancelled' &&
    ['pending', 'confirmed', 'processing'].includes(params.order.status)
  ) {
    await Promise.all(
      (params.order.itemsSnapshot || []).map(async (line) => {
        const ref = doc(db, 'marketplaceListings', line.productId);
        const snap = await getDoc(ref).catch(() => null);
        if (snap?.exists()) {
          const data = snap.data()!;
          const restored = Number(data.quantity || 0) + Number(line.quantity || 1);
          await updateDoc(ref, {
            quantity: restored,
            soldCount: Math.max(0, Number(data.soldCount || 0) - Number(line.quantity || 1)),
            status: data.status === 'out_of_stock' ? 'active' : data.status,
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      })
    );
  }

  if (params.nextStatus === 'delivered' && params.order.storeId) {
    await updateDoc(doc(db, 'stores', params.order.storeId), {
      totalSales: increment(1),
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  const recipientId =
    params.actorUid === params.order.buyerId ? params.order.sellerId : params.order.buyerId;
  await addDoc(collection(db, 'notifications'), {
    recipientId,
    actorId: params.actorUid,
    actorName: params.actorName,
    actorAvatar: '',
    type: 'marketplace',
    title: `Order ${params.nextStatus.toUpperCase()}`,
    body: `Order #${params.order.id.slice(-6)} is now ${params.nextStatus}.`,
    linkUrl: params.actorUid === params.order.buyerId ? '/market?tab=seller' : '/market?tab=orders',
    dedupeKey: `order_${params.order.id}_${params.nextStatus}`,
    isRead: false,
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

// =========================================================================
// Verified Purchase Reviews & Reports
// =========================================================================
export async function fetchProductReviews(productId: string): Promise<ProductReview[]> {
  try {
    const { items } = await getDocsWithIndexFallback<ProductReview>(
      query(
        collection(db, 'productReviews'),
        where('productId', '==', productId),
        where('status', '==', 'active'),
        orderBy('createdAt', 'desc'),
        limit(40)
      ),
      query(
        collection(db, 'productReviews'),
        where('productId', '==', productId),
        where('status', '==', 'active'),
        limit(50)
      ),
      sortByCreatedAtDesc
    );
    return items.slice(0, 40);
  } catch {
    return [];
  }
}

export async function fetchEligibleReviewOrder(uid: string, productId: string): Promise<MarketplaceOrder | null> {
  const res = await getDocsWithIndexFallback<MarketplaceOrder>(
    query(collection(db, 'orders'), where('buyerId', '==', uid), orderBy('createdAt', 'desc'), limit(40)),
    query(collection(db, 'orders'), where('buyerId', '==', uid), limit(50)),
    sortByCreatedAtDesc
  ).catch(() => null);
  if (!res) return null;

  for (const ord of res.items) {
    if (ord.status !== 'delivered') continue;
    if (!(ord.itemProductIds || []).includes(productId)) continue;
    const revId = `${ord.id}_${productId}_${uid}`;
    const revSnap = await getDoc(doc(db, 'productReviews', revId)).catch(() => null);
    if (!revSnap?.exists()) {
      return ord;
    }
  }
  return null;
}

export async function submitVerifiedProductReview(params: {
  reviewer: BanaUser;
  order: MarketplaceOrder;
  product: BanaMarketListing;
  rating: number;
  comment: string;
  imageUrls?: string[];
}): Promise<ProductReview> {
  const revId = `${params.order.id}_${params.product.id}_${params.reviewer.uid}`;
  const existing = await getDoc(doc(db, 'productReviews', revId));
  if (existing.exists()) {
    throw new Error('You have already reviewed this product for this order.');
  }

  await setDoc(doc(db, 'productReviews', revId), {
    productId: params.product.id,
    sellerId: params.product.sellerId,
    storeId: params.product.storeId || '',
    orderId: params.order.id,
    reviewerId: params.reviewer.uid,
    reviewerName: params.reviewer.displayName,
    reviewerUsername: params.reviewer.username,
    reviewerAvatar: params.reviewer.avatarUrl || '',
    rating: Math.max(1, Math.min(5, Math.round(params.rating))),
    comment: params.comment.trim().slice(0, 2000),
    imageUrls: (params.imageUrls || []).slice(0, 4),
    isVerifiedPurchase: true,
    helpfulUserIds: [],
    helpfulCount: 0,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  // Recalculate product & store rating averages cleanly from active reviews
  const prodReviews = await fetchProductReviews(params.product.id);
  if (prodReviews.length > 0) {
    const avg = Number(
      (prodReviews.reduce((s, r) => s + Number(r.rating || 0), 0) / prodReviews.length).toFixed(2)
    );
    await updateDoc(doc(db, 'marketplaceListings', params.product.id), {
      ratingAvg: avg,
      reviewsCount: prodReviews.length,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  if (params.product.storeId) {
    const storeSnap = await getDocs(
      query(
        collection(db, 'productReviews'),
        where('storeId', '==', params.product.storeId),
        where('status', '==', 'active'),
        limit(100)
      )
    ).catch(() => null);
    if (storeSnap && !storeSnap.empty) {
      const storeRevs = storeSnap.docs.map((d) => d.data());
      const avg = Number(
        (storeRevs.reduce((s, r) => s + Number(r.rating || 0), 0) / storeRevs.length).toFixed(2)
      );
      await updateDoc(doc(db, 'stores', params.product.storeId), {
        ratingAvg: avg,
        reviewsCount: storeRevs.length,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  }

  const created = await getDoc(doc(db, 'productReviews', revId));
  return { id: created.id, ...(created.data() as Omit<ProductReview, 'id'>) };
}

export async function toggleReviewHelpful(review: ProductReview, uid: string): Promise<void> {
  const current = review.helpfulUserIds || [];
  const hasVoted = current.includes(uid);
  const nextIds = hasVoted ? current.filter((x) => x !== uid) : [...current, uid];
  await updateDoc(doc(db, 'productReviews', review.id), {
    helpfulUserIds: nextIds,
    helpfulCount: nextIds.length,
    updatedAt: serverTimestamp(),
  });
}

export async function submitMarketplaceReport(params: {
  reporterId: string;
  targetType: 'product' | 'store' | 'review' | 'community' | 'event' | 'community_member' | 'community_post';
  targetId: string;
  communityId?: string;
  reason: string;
  details: string;
}) {
  if (params.reason.trim().length < 2) throw new Error('Please choose a reason.');
  // Deterministic id: a second report by the same user on the same target becomes an "update",
  // which Firestore rules only allow for staff, so duplicates are rejected by the backend.
  const id = `${params.targetType}_${params.targetId}_${params.reporterId}`.replace(/[^a-zA-Z0-9_\-:.]/g, '_').slice(0, 128);
  try {
    await setDoc(doc(db, 'marketplaceReports', id), {
      reporterId: params.reporterId,
      targetType: params.targetType,
      targetId: params.targetId,
      ...(params.communityId ? { communityId: params.communityId } : {}),
      reason: params.reason.trim().slice(0, 120),
      details: params.details.trim().slice(0, 1000),
      status: 'pending',
      createdAt: serverTimestamp(),
    });
  } catch (err: any) {
    if (err?.code === 'permission-denied') throw new Error('You have already reported this. Our team is reviewing it.');
    throw err;
  }
}

export async function startOrOpenSellerChat(params: {
  buyer: BanaUser;
  sellerId: string;
  sellerName: string;
  sellerUsername: string;
  sellerAvatar?: string;
  initialMessage?: string;
}): Promise<string> {
  const existingSnap = await getDocs(
    query(collection(db, 'conversations'), where('participantIds', 'array-contains', params.buyer.uid))
  );
  const existing = existingSnap.docs.find((d) => {
    const data = d.data();
    return !data.isGroup && Array.isArray(data.participantIds) && data.participantIds.includes(params.sellerId);
  });

  if (existing) {
    if (params.initialMessage) {
      await addDoc(collection(db, 'messages'), {
        conversationId: existing.id,
        senderId: params.buyer.uid,
        type: 'text',
        text: params.initialMessage,
        readBy: [params.buyer.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'conversations', existing.id), {
        lastMessageText: params.initialMessage.slice(0, 140),
        lastMessageSenderId: params.buyer.uid,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
    return existing.id;
  }

  const preview = params.initialMessage || `Started a marketplace inquiry with ${params.sellerName}`;
  const convRef = await addDoc(collection(db, 'conversations'), {
    participantIds: [params.buyer.uid, params.sellerId],
    participantMeta: {
      [params.buyer.uid]: {
        displayName: params.buyer.displayName,
        username: params.buyer.username,
        avatarUrl: params.buyer.avatarUrl || '',
      },
      [params.sellerId]: {
        displayName: params.sellerName,
        username: params.sellerUsername,
        avatarUrl: params.sellerAvatar || '',
      },
    },
    isGroup: false,
    lastMessageText: preview.slice(0, 140),
    lastMessageSenderId: params.buyer.uid,
    isRequest: false,
    unreadCounts: { [params.sellerId]: 1 },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (params.initialMessage) {
    await addDoc(collection(db, 'messages'), {
      conversationId: convRef.id,
      senderId: params.buyer.uid,
      type: 'text',
      text: params.initialMessage,
      readBy: [params.buyer.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  return convRef.id;
}

export async function fetchOrderPaymentsForSellerOrBuyer(
  uid: string,
  role: 'buyer' | 'seller'
): Promise<MarketplacePayment[]> {
  const field = role === 'buyer' ? 'buyerId' : 'sellerId';
  try {
    const { items } = await getDocsWithIndexFallback<MarketplacePayment>(
      query(collection(db, 'payments'), where(field, '==', uid), orderBy('createdAt', 'desc'), limit(50)),
      query(collection(db, 'payments'), where(field, '==', uid), limit(60)),
      sortByCreatedAtDesc
    );
    return items.slice(0, 50);
  } catch {
    return [];
  }
}


// =========================================================================
// Prompt 07 — Seller Application Workflow (apply → staff review → store)
// =========================================================================
export async function fetchMySellerApplication(uid: string): Promise<SellerApplication | null> {
  try {
    const snap = await getDoc(doc(db, 'sellerApplications', uid));
    return snap.exists() ? ({ id: snap.id, ...(snap.data() as Omit<SellerApplication, 'id'>) }) : null;
  } catch (err) {
    logFirestoreError(err, OperationType.GET, `sellerApplications/${uid}`);
    return null;
  }
}

export interface SellerApplicationInput {
  storeName: string;
  storeDescription: string;
  district: string;
  productCategories: string[];
  contactPhone?: string;
  contactEmail?: string;
  businessType: 'individual' | 'registered_business';
  acceptedSellerPolicy: boolean;
}

/** One application per user (doc id == uid). Re-applying is only possible after a rejection. */
export async function submitSellerApplication(
  profile: BanaUser,
  input: SellerApplicationInput
): Promise<SellerApplication> {
  const name = input.storeName.trim();
  const desc = input.storeDescription.trim();
  if (name.length < 2) throw new Error('Store name must be at least 2 characters.');
  if (desc.length < 10) throw new Error('Please describe what you plan to sell (at least 10 characters).');
  if (!input.acceptedSellerPolicy) throw new Error('You must accept the seller policy to apply.');

  const ref = doc(db, 'sellerApplications', profile.uid);
  const existing = await getDoc(ref);
  const body = {
    uid: profile.uid,
    username: profile.username,
    displayName: profile.displayName,
    storeName: name,
    storeDescription: desc,
    district: input.district.trim() || 'Dhaka',
    productCategories: input.productCategories.slice(0, 10),
    contactPhone: (input.contactPhone || '').trim(),
    contactEmail: (input.contactEmail || '').trim(),
    businessType: input.businessType,
    acceptedSellerPolicy: true,
    status: 'pending' as const,
  };

  if (existing.exists()) {
    const status = (existing.data() as SellerApplication).status;
    if (status !== 'rejected') {
      throw new Error(
        status === 'approved'
          ? 'Your seller application is already approved.'
          : 'You already have a seller application under review.'
      );
    }
    await updateDoc(ref, { ...body, updatedAt: serverTimestamp() });
  } else {
    await setDoc(ref, { ...body, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  const saved = await getDoc(ref);
  return { id: saved.id, ...(saved.data() as Omit<SellerApplication, 'id'>) };
}

/** Staff decision. Writes the decision, notifies the applicant once (dedupeKey) and returns. */
export async function reviewSellerApplication(params: {
  application: SellerApplication;
  decision: 'approved' | 'rejected';
  adminUid: string;
  adminName: string;
  note: string;
}): Promise<void> {
  const note = params.note.trim();
  if (params.decision === 'rejected' && note.length < 3) {
    throw new Error('Please provide a rejection reason for the applicant.');
  }
  if (params.application.status !== 'pending') {
    throw new Error('This application has already been decided.');
  }
  await updateDoc(doc(db, 'sellerApplications', params.application.id), {
    status: params.decision,
    adminNote: note,
    reviewedBy: params.adminUid,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await addDoc(collection(db, 'notifications'), {
    recipientId: params.application.uid,
    actorId: params.adminUid,
    actorName: params.adminName,
    actorAvatar: '',
    type: 'marketplace',
    title: params.decision === 'approved' ? 'Seller application approved' : 'Seller application rejected',
    body:
      params.decision === 'approved'
        ? 'You can now create your BANA seller storefront and list products.'
        : `Your seller application was not approved.${note ? ' Reason: ' + note : ''}`,
    linkUrl: '/market?tab=seller',
    dedupeKey: `seller_app_${params.application.id}_${params.decision}_${Date.now().toString(36)}`,
    isRead: false,
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

// =========================================================================
// Prompt 07 — Review moderation (hide / restore) with aggregate recompute
// =========================================================================
export async function moderateProductReview(params: {
  review: ProductReview;
  nextStatus: 'active' | 'hidden';
  adminUid: string;
  adminName: string;
  note?: string;
}): Promise<void> {
  const { review, nextStatus } = params;
  await updateDoc(doc(db, 'productReviews', review.id), {
    status: nextStatus,
    moderationNote: (params.note || '').trim(),
    moderatedBy: params.adminUid,
    updatedAt: serverTimestamp(),
  });
  // Recompute the product aggregate from ACTIVE reviews only (never trust a delta).
  try {
    const snap = await getDocs(
      query(collection(db, 'productReviews'), where('productId', '==', review.productId), where('status', '==', 'active'))
    );
    const ratings = snap.docs.map((d) => Number((d.data() as any).rating) || 0).filter((n) => n > 0);
    const avg = ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : 0;
    await updateDoc(doc(db, 'marketplaceListings', review.productId), {
      ratingAvg: avg,
      reviewsCount: ratings.length,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    if (review.storeId) {
      const sSnap = await getDocs(
        query(collection(db, 'productReviews'), where('storeId', '==', review.storeId), where('status', '==', 'active'))
      );
      const sr = sSnap.docs.map((d) => Number((d.data() as any).rating) || 0).filter((n) => n > 0);
      await updateDoc(doc(db, 'stores', review.storeId), {
        ratingAvg: sr.length ? Math.round((sr.reduce((a, b) => a + b, 0) / sr.length) * 100) / 100 : 0,
        reviewsCount: sr.length,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
  } catch {
    /* aggregate refresh is best-effort; moderation itself already succeeded */
  }
}
