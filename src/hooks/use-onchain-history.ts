import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount } from "wagmi";
import { TxHistoryEntry, getTxHistory, saveTxHistory } from "@/lib/tx-history-store";
import { supabase } from "@/lib/supabase";
import { useEnvironment } from "@/contexts/EnvironmentContext";

// ── Per-page cache ────────────────────────────────────────────────────────────
// Key: "wallet:env:status:cursor" — stores only the 10 items for that page.
// Never caches 100 records; each entry holds ≤ MAX_PAGE_SIZE items.
const pageCache = new Map<string, { data: TxHistoryEntry[]; nextCursor: string | null; hasMore: boolean; timestamp: number }>();
const PAGE_CACHE_TTL_MS = 30_000; // 30 seconds

function buildCacheKey(wallet: string, env: string, status: string, cursor: string | null): string {
  return `history:${wallet.toLowerCase()}:${env}:${status}:${cursor ?? "start"}`;
}

export function invalidateHistoryPageCache(walletAddress?: string) {
  const prefix = walletAddress ? `history:${walletAddress.toLowerCase()}` : "history:";
  for (const key of Array.from(pageCache.keys())) {
    if (key.startsWith(prefix)) {
      pageCache.delete(key);
    }
  }
}

export function clearHistoryCache(walletAddress?: string, mode?: "testnet" | "mainnet") {
  invalidateHistoryPageCache(walletAddress);

  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent("arc-history-updated", { detail: { walletAddress, mode } }));
    } catch (_) {}
  }
}

// ── Hook parameters ───────────────────────────────────────────────────────────
export interface UseOnChainHistoryParams {
  hasAccess?: boolean;
  enabled?: boolean;
  /** Current page cursor — null means first page */
  cursor: string | null;
  /** Status filter passed through to the API */
  statusFilter: "all" | "success" | "pending" | "failed";
}

export interface UseOnChainHistoryResult {
  /** Current page items (≤ 10) */
  history: TxHistoryEntry[];
  isLoading: boolean;
  hasMore: boolean;
  /** Cursor for the next page; null if no more pages */
  nextCursor: string | null;
  /** Force a fresh fetch for the current page */
  refetchHistory: (force?: boolean) => Promise<void>;
  /** Optimistically mutate a single transaction in the current page */
  mutateHistory: (txHash: string, newStatus: "success" | "failed" | "pending", newEntry?: Partial<TxHistoryEntry>) => void;
}

const MAX_PAGE_SIZE = 10;

export function useOnChainHistory(
  hasAccessOrParams: boolean | UseOnChainHistoryParams = true
): UseOnChainHistoryResult {
  // Support legacy call signature: useOnChainHistory(hasAccess: boolean)
  const params: UseOnChainHistoryParams =
    typeof hasAccessOrParams === "boolean"
      ? { hasAccess: hasAccessOrParams, enabled: hasAccessOrParams, cursor: null, statusFilter: "all" }
      : hasAccessOrParams;

  const { hasAccess = true, enabled = true, cursor, statusFilter } = params;

  const { address } = useAccount();
  const { mode } = useEnvironment();

  const [history, setHistory] = useState<TxHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const inFlightRef = useRef(false);
  const reconcileInFlightRef = useRef(false);
  const lastForcedFetchTimeRef = useRef<number>(0);
  const lastReconcileTimeRef = useRef<number>(0);

  const fetchHistory = useCallback(
    async (force = false) => {
      // If hook is disabled (e.g. user is on Bridge form or another view) or lacks access, do nothing
      if (!enabled || !hasAccess) {
        setIsLoading(false);
        return;
      }
      if (!address) {
        setHistory([]);
        setHasMore(false);
        setNextCursor(null);
        setIsLoading(false);
        return;
      }

      const walletAddress = address.toLowerCase();
      const cacheKey = buildCacheKey(walletAddress, mode, statusFilter, cursor);
      const now = Date.now();
      const cached = pageCache.get(cacheKey);

      if (!force && cached && now - cached.timestamp < PAGE_CACHE_TTL_MS) {
        setHistory(cached.data);
        setHasMore(cached.hasMore);
        setNextCursor(cached.nextCursor);
        setIsLoading(false);
        return;
      }

      if (inFlightRef.current) return;
      if (force && now - lastForcedFetchTimeRef.current < 2000) {
        return;
      }
      if (force) {
        lastForcedFetchTimeRef.current = now;
      }

      inFlightRef.current = true;
      setIsLoading(true);
      try {
        // ── 1. Fetch current bridge page from the backend API (strictly ≤ MAX_PAGE_SIZE) ──
        const queryParams = new URLSearchParams({
          wallet: walletAddress,
          environment: mode,
          status: statusFilter,
          limit: String(MAX_PAGE_SIZE),
        });
        if (cursor) queryParams.set("cursor", cursor);

        const res = await fetch(`/api/bridge/history?${queryParams.toString()}`, {
          headers: {
            "Cache-Control": "no-cache",
          },
          cache: "no-store",
        });

        const json = await res.json();

        let supabaseBridges: TxHistoryEntry[] = [];
        let apiNextCursor: string | null = null;
        let apiHasMore = false;

        if (json.success && json.data) {
          apiNextCursor = json.nextCursor ?? null;
          apiHasMore = json.hasMore ?? false;

          supabaseBridges = (json.data as any[]).map((dbTx) => ({
            id: dbTx.burn_tx_hash || dbTx.id || `bridge_${new Date(dbTx.created_at).getTime()}`,
            txHash: dbTx.burn_tx_hash || "",
            burnHash: dbTx.burn_tx_hash || "",
            mintHash: dbTx.mint_tx_hash,
            type: "bridge_cctp" as const,
            timestamp: new Date(dbTx.created_at).getTime(),
            status:
              dbTx.bridge_status === "COMPLETED"
                ? ("success" as const)
                : dbTx.bridge_status === "FAILED"
                ? ("failed" as const)
                : dbTx.bridge_status === "PROCESSING_CLAIM"
                ? (dbTx.updated_at && (Date.now() - new Date(dbTx.updated_at).getTime() < 45000) ? ("claiming" as any) : ("pending" as const))
                : ("pending" as const),
            amount: dbTx.amount,
            fromAsset: dbTx.token_symbol,
            toAsset: dbTx.token_symbol,
            sourceChain: dbTx.source_chain,
            destChain: dbTx.destination_chain,
            userAddress: dbTx.wallet_address,
            failureReason: dbTx.failure_reason,
          }));
        }

        // ── 2. Local pending bridge transactions — ONLY for the FIRST page (cursor === null) ──
        let localPending: TxHistoryEntry[] = [];
        if (cursor === null) {
          const localCache = getTxHistory(mode).filter(
            (tx) => tx.userAddress?.toLowerCase() === walletAddress && tx.type !== ("swap" as any)
          );
          const STALE_PENDING_MS = 30 * 60 * 1000;
          localPending = localCache
            .filter((tx) => {
              if (tx.status !== "pending") return false;
              if (Date.now() - tx.timestamp > STALE_PENDING_MS) return false;
              return !supabaseBridges.some((sb) => sb.txHash === tx.txHash);
            })
            .map((tx) => ({ ...tx }));

          // Reconcile localPending against the freshly returned supabaseBridges in-memory (0ms, no extra remote queries)
          if (localPending.length > 0) {
            const resolvedHashes = new Set<string>();
            for (const sb of supabaseBridges) {
              if (sb.status === "success" || sb.status === "failed") {
                const matchHash = (sb.burnHash || sb.txHash || "").toLowerCase();
                resolvedHashes.add(matchHash);
                const local = localCache.find(
                  (lc) => (lc.txHash || lc.burnHash)?.toLowerCase() === matchHash
                );
                if (local) {
                  saveTxHistory(
                    {
                      ...local,
                      status: sb.status,
                      mintHash: sb.mintHash || local.mintHash,
                      failureReason: sb.failureReason,
                    },
                    mode,
                    { skipEvent: true }
                  );
                }
              }
            }
            localPending = localPending.filter(
              (tx) => !resolvedHashes.has((tx.txHash || tx.burnHash || "").toLowerCase())
            );
          }
        }

        // ── 3. Merge: local pending + supabase page (Bridge Only) ──────────
        const mergedMap = new Map<string, TxHistoryEntry>();

        // Insert local pending first
        localPending.forEach((tx) => mergedMap.set(tx.txHash, tx));

        // Insert supabase bridge page (server-authoritative — overwrites local for matching txHash)
        const localCache = cursor === null
          ? getTxHistory(mode).filter((tx) => tx.userAddress?.toLowerCase() === walletAddress)
          : [];

        supabaseBridges.forEach((tx) => {
          mergedMap.set(tx.txHash, tx);
          if (tx.status === "failed" || tx.status === "success") {
            const local = localCache.find((lc) => lc.txHash === tx.txHash);
            if (local && local.status === "pending") {
              saveTxHistory(
                { ...local, status: tx.status, failureReason: tx.failureReason },
                mode,
                { skipEvent: true }
              );
            }
          }
        });

        // Filter by user address, auto-expire stale claim locks, sort descending by timestamp
        const mergedSorted = Array.from(mergedMap.values())
          .filter((tx) => tx.userAddress?.toLowerCase() === walletAddress)
          .map((tx) => {
            if ((tx.status as string) === "claiming" && Date.now() - tx.timestamp > 45 * 1000) {
              return { ...tx, status: "pending" as const };
            }
            return tx;
          })
          .sort((a, b) => b.timestamp - a.timestamp);

        // Strict client-side slice to MAX_PAGE_SIZE (10 records)
        const finalPage = mergedSorted.slice(0, MAX_PAGE_SIZE);

        // Cache page
        pageCache.set(cacheKey, {
          data: finalPage,
          nextCursor: apiNextCursor,
          hasMore: apiHasMore,
          timestamp: Date.now(),
        });

        setHistory(finalPage);
        setNextCursor(apiNextCursor);
        setHasMore(apiHasMore);
      } catch (err) {
        console.error("[useOnChainHistory] Failed to fetch:", err);
        const localCache = getTxHistory(mode).filter(
          (tx) => tx.userAddress?.toLowerCase() === (address?.toLowerCase() ?? "") && tx.type !== ("swap" as any)
        );
        setHistory(localCache.slice(0, MAX_PAGE_SIZE));
        setHasMore(false);
        setNextCursor(null);
      } finally {
        inFlightRef.current = false;
        setIsLoading(false);
      }
    },
    [address, enabled, hasAccess, mode, cursor, statusFilter]
  );

  // Fetch only when parameters change
  useEffect(() => {
    if (enabled && hasAccess) {
      fetchHistory();
    }
  }, [fetchHistory, enabled, hasAccess]);

  // Reactive listener: on bridge tx save/cancel, invalidate first page cache and refetch (DEBOUNCED & NO RE-DISPATCH)
  useEffect(() => {
    if (!enabled || !hasAccess) return;

    let debounceTimer: any = null;
    const handleHistoryUpdated = (e: Event) => {
      const customEvt = e as CustomEvent<{ walletAddress?: string }>;
      if (!address) return;
      if (
        !customEvt.detail?.walletAddress ||
        customEvt.detail.walletAddress.toLowerCase() === address.toLowerCase()
      ) {
        invalidateHistoryPageCache(address);
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          fetchHistory(true);
        }, 500);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("arc-history-updated", handleHistoryUpdated);
    }
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (typeof window !== "undefined") {
        window.removeEventListener("arc-history-updated", handleHistoryUpdated);
      }
    };
  }, [address, enabled, hasAccess, fetchHistory]);

  // Independent background reconciliation for pending bridge transactions (throttled)
  useEffect(() => {
    if (!enabled || !hasAccess || !address) return;
    const hasPending = history.some((tx) => tx.status === "pending" || (tx.status as string) === "claiming");
    if (!hasPending) return;

    const now = Date.now();
    if (now - lastReconcileTimeRef.current < 20_000 || reconcileInFlightRef.current) return;
    lastReconcileTimeRef.current = now;
    reconcileInFlightRef.current = true;

    fetch("/api/bridge/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet_address: address, environment: mode }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.processed > 0) {
          invalidateHistoryPageCache(address);
          fetchHistory(true);
        }
      })
      .catch((err) => {
        console.warn("[useOnChainHistory] Background reconcile notice:", err);
      })
      .finally(() => {
        reconcileInFlightRef.current = false;
      });
  }, [history, enabled, hasAccess, address, mode, fetchHistory]);

  // Re-check pending transactions when user switches browser tabs back to app
  useEffect(() => {
    if (!enabled || !hasAccess) return;
    const hasPending = history.some((tx) => tx.status === "pending");
    if (!hasPending) return;

    let isSubscribed = true;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && isSubscribed) {
        fetchHistory(true);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      isSubscribed = false;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [history, enabled, hasAccess, fetchHistory]);

  const mutateHistory = (
    txHash: string,
    newStatus: "success" | "failed" | "pending",
    newEntry?: Partial<TxHistoryEntry>
  ) => {
    setHistory((prev) => {
      const exists = prev.some((tx) => tx.txHash === txHash);
      let updated: TxHistoryEntry[];

      if (exists) {
        updated = prev.map((tx) =>
          tx.txHash === txHash ? { ...tx, status: newStatus, ...newEntry } : tx
        );
      } else if (newEntry) {
        const entry = {
          id: txHash,
          txHash,
          type: "bridge_cctp",
          status: newStatus,
          timestamp: Date.now(),
          ...newEntry,
        } as TxHistoryEntry;
        updated = [entry, ...prev].slice(0, MAX_PAGE_SIZE);
      } else {
        updated = prev;
      }

      if (address) {
        const cacheKey = buildCacheKey(address.toLowerCase(), mode, statusFilter, cursor);
        pageCache.delete(cacheKey);
      }

      return updated;
    });
  };

  return { history, isLoading, hasMore, nextCursor, mutateHistory, refetchHistory: fetchHistory };
}
