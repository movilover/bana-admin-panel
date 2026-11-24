import {
  getDocs,
  onSnapshot,
  type DocumentData,
  type Query,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';

export function isMissingIndexError(error: unknown): boolean {
  if (!error) return false;
  const code = (error as { code?: string })?.code || '';
  const message = error instanceof Error ? error.message : String(error);
  return (
    code === 'failed-precondition' ||
    /requires an index|failed-precondition|create_composite/i.test(message)
  );
}

export function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  const obj = value as { toMillis?: () => number; toDate?: () => Date; seconds?: number; nanoseconds?: number };
  if (typeof obj.toMillis === 'function') return obj.toMillis();
  if (typeof obj.toDate === 'function') return obj.toDate().getTime();
  if (typeof obj.seconds === 'number') {
    return obj.seconds * 1000 + Math.floor((obj.nanoseconds || 0) / 1e6);
  }
  return 0;
}

export function sortByCreatedAtDesc<T extends { createdAt?: unknown }>(a: T, b: T): number {
  return toMillis(b.createdAt) - toMillis(a.createdAt);
}

export function sortByCreatedAtAsc<T extends { createdAt?: unknown }>(a: T, b: T): number {
  return toMillis(a.createdAt) - toMillis(b.createdAt);
}

export interface FallbackQueryResult<T> {
  items: T[];
  usedFallback: boolean;
  snap: QuerySnapshot<DocumentData>;
}

/**
 * Executes a Firestore `getDocs` query and automatically falls back to an
 * index-free query + client-side sort if Firestore reports a missing composite index.
 */
export async function getDocsWithIndexFallback<T extends { id: string }>(
  primaryQuery: Query<DocumentData>,
  fallbackQuery: Query<DocumentData>,
  comparator?: (a: T, b: T) => number
): Promise<FallbackQueryResult<T>> {
  try {
    const snap = await getDocs(primaryQuery);
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<T, 'id'>) }) as T);
    return { items, usedFallback: false, snap };
  } catch (err) {
    if (!isMissingIndexError(err)) {
      throw err;
    }
    const snap = await getDocs(fallbackQuery);
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<T, 'id'>) }) as T);
    if (comparator) {
      items.sort(comparator);
    } else {
      items.sort((a, b) => sortByCreatedAtDesc(a as { createdAt?: unknown }, b as { createdAt?: unknown }));
    }
    return { items, usedFallback: true, snap };
  }
}

/**
 * Attaches an `onSnapshot` listener and automatically switches to an index-free
 * fallback listener + client-side sort if Firestore reports a missing composite index.
 */
export function subscribeWithIndexFallback<T extends { id: string }>(params: {
  primaryQuery: Query<DocumentData>;
  fallbackQuery: Query<DocumentData>;
  comparator?: (a: T, b: T) => number;
  onData: (items: T[], usedFallback: boolean) => void;
  onError?: (error: unknown) => void;
}): Unsubscribe {
  let active = true;
  let unsubFallback: Unsubscribe | null = null;
  let unsubPrimary: Unsubscribe | null = null;

  const mapAndSort = (snap: QuerySnapshot<DocumentData>, sortItems: boolean): T[] => {
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<T, 'id'>) }) as T);
    if (sortItems) {
      if (params.comparator) {
        items.sort(params.comparator);
      } else {
        items.sort((a, b) => sortByCreatedAtDesc(a as { createdAt?: unknown }, b as { createdAt?: unknown }));
      }
    }
    return items;
  };

  unsubPrimary = onSnapshot(
    params.primaryQuery,
    (snap) => {
      if (!active) return;
      params.onData(mapAndSort(snap, false), false);
    },
    (err) => {
      if (!active) return;
      if (isMissingIndexError(err)) {
        if (unsubPrimary) {
          try {
            unsubPrimary();
          } catch {
            // ignore cleanup error
          }
          unsubPrimary = null;
        }
        unsubFallback = onSnapshot(
          params.fallbackQuery,
          (fallbackSnap) => {
            if (!active) return;
            params.onData(mapAndSort(fallbackSnap, true), true);
          },
          (fallbackErr) => {
            if (!active) return;
            params.onError?.(fallbackErr);
          }
        );
        return;
      }
      params.onError?.(err);
    }
  );

  return () => {
    active = false;
    if (unsubPrimary) {
      try {
        unsubPrimary();
      } catch {
        // ignore
      }
    }
    if (unsubFallback) {
      try {
        unsubFallback();
      } catch {
        // ignore
      }
    }
  };
}
