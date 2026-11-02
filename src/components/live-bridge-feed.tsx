"use client";

import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useEnvironment } from "@/contexts/EnvironmentContext";

interface LiveTx {
  id: string;
  wallet_address: string;
  source_chain: string;
  destination_chain: string;
  token_symbol: string;
  amount: string;
  burn_tx_hash: string;
  mint_tx_hash?: string;
  bridge_status: string;
  created_at: string;
  updated_at?: string;
}

function formatAddress(addr: string): string {
  if (!addr) return "0x...";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function cleanChainName(chain: string): string {
  if (!chain) return "Unknown";
  return chain
    .replace(" Sepolia", "")
    .replace(" Testnet", "")
    .replace(" Devnet", "")
    .replace(" Mainnet", "");
}

function timeAgo(dateStr: string): string {
  const diffSec = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

function getExplorerUrl(chain: string, txHash: string): string | null {
  if (!txHash) return null;
  if (chain === "X Layer Testnet") return `https://www.okx.com/web3/explorer/xlayer-test/tx/${txHash}`;
  if (chain.includes("Solana")) return `https://solscan.io/tx/${txHash}?cluster=devnet`;
  if (chain === "Stellar Testnet") return `https://stellar.expert/explorer/testnet/tx/${txHash}`;
  if (chain === "Arc Testnet") return `https://testnet.arcscan.app/tx/${txHash}`;
  if (chain === "Arc Mainnet" || chain === "Arc") return `https://explorer.arc.io/tx/${txHash}`;
  if (chain === "Base Mainnet") return `https://basescan.org/tx/${txHash}`;
  if (chain === "Arbitrum Mainnet") return `https://arbiscan.io/tx/${txHash}`;
  if (chain === "Base Sepolia") return `https://sepolia.basescan.org/tx/${txHash}`;
  if (chain === "Ethereum Sepolia") return `https://sepolia.etherscan.io/tx/${txHash}`;
  if (chain === "Arbitrum Sepolia") return `https://sepolia.arbiscan.io/tx/${txHash}`;
  return null;
}

export function LiveBridgeFeed() {
  const [isOpen, setIsOpen] = useState(false);
  const [transactions, setTransactions] = useState<LiveTx[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchInitialFeed = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/bridge/live-feed?limit=10&offset=0");
      if (res.ok) {
        const data = await res.json();
        if (data.transactions) {
          setTransactions(data.transactions);
        }
      }
    } catch (e) {
      console.error("Failed to fetch initial live feed:", e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialFeed();
  }, [fetchInitialFeed]);

  const toggleOpen = () => setIsOpen((prev) => !prev);

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9999, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
      {isOpen && (
        <div
          style={{
            width: 380,
            maxHeight: 520,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 16,
            boxShadow: "0 16px 40px rgba(0,0,0,0.18)",
            display: "flex",
            flexDirection: "column",
            marginBottom: 10,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>
              Global Activity Feed
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={fetchInitialFeed}
                disabled={isLoading}
                style={{
                  background: "var(--surface-soft, rgba(0,0,0,0.04))",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                {isLoading ? "Loading..." : "Refresh"}
              </button>
              <button
                onClick={toggleOpen}
                style={{
                  background: "var(--surface-soft, rgba(0,0,0,0.04))",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "4px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {transactions.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No recent activity found.
              </div>
            ) : (
              transactions.map((tx) => {
                const isCompleted = tx.bridge_status === "COMPLETED";
                const isFailed = tx.bridge_status === "FAILED";
                const burnUrl = getExplorerUrl(tx.source_chain, tx.burn_tx_hash);
                const mintUrl = tx.mint_tx_hash ? getExplorerUrl(tx.destination_chain, tx.mint_tx_hash) : null;

                return (
                  <div
                    key={tx.id}
                    style={{
                      background: "var(--bg, rgba(0,0,0,0.02))",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      padding: "10px 12px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                        {cleanChainName(tx.source_chain)} -&gt; {cleanChainName(tx.destination_chain)}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)" }}>
                        {tx.amount} {tx.token_symbol || "USDC"}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}>
                      <span>{formatAddress(tx.wallet_address)} • {timeAgo(tx.created_at)}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 600 }}>{isCompleted ? "Completed" : isFailed ? "Failed" : "Processing"}</span>
                        {(burnUrl || mintUrl) && (
                          <a href={(mintUrl || burnUrl)!} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-primary)", textDecoration: "underline", fontWeight: 600 }}>
                            Explorer
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      <button
        onClick={toggleOpen}
        style={{
          background: "#18181b",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: 9999,
          padding: "10px 20px",
          color: "#ffffff",
          fontWeight: 700,
          fontSize: 13,
          cursor: "pointer",
          boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
        }}
      >
        Live Feed {isOpen ? "[-]" : "[+]"}
      </button>
    </div>
  );
}

export function LiveFeedHistoryView() {
  const { mode } = useEnvironment();
  const [transactions, setTransactions] = useState<LiveTx[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const pageSize = 10;

  const fetchFeed = useCallback(async (targetPage: number) => {
    setIsLoading(true);
    const offset = (targetPage - 1) * pageSize;
    try {
      const res = await fetch(`/api/bridge/live-feed?limit=${pageSize}&offset=${offset}&network=${mode}`);
      if (res.ok) {
        const data = await res.json();
        if (data.transactions) {
          setTransactions(data.transactions);
          setTotalCount(data.totalCount || 0);
          setPage(targetPage);
        }
      }
    } catch (e) {
      console.error("Failed to fetch live feed page:", e);
    } finally {
      setIsLoading(false);
    }
  }, [pageSize, mode]);

  useEffect(() => {
    fetchFeed(1);
  }, [fetchFeed, mode]);

  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
      {/* Header Bar (Compact) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
            Global Transactions
          </span>
          <span style={{
            fontSize: 10,
            fontWeight: 700,
            padding: "1px 6px",
            borderRadius: 4,
            background: mode === "mainnet" ? "#18181b" : "var(--surface-soft, rgba(0,0,0,0.05))",
            color: mode === "mainnet" ? "#ffffff" : "var(--text-muted)",
            border: "1px solid var(--border)",
            textTransform: "uppercase"
          }}>
            {mode}
          </span>
          <span style={{ fontSize: 10.5, color: "var(--text-muted)", background: "var(--surface-soft, rgba(0,0,0,0.04))", border: "1px solid var(--border)", padding: "1px 7px", borderRadius: 6, fontWeight: 600 }}>
            {totalCount} Total
          </span>
        </div>

        <button
          onClick={() => fetchFeed(page)}
          disabled={isLoading}
          style={{
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "3px 10px",
            color: "var(--text-primary)",
            fontSize: 11,
            fontWeight: 600,
            cursor: isLoading ? "not-allowed" : "pointer",
          }}
        >
          {isLoading ? "..." : "Refresh"}
        </button>
      </div>

      {/* Feed Items (Strictly 10 at a time, Compact) */}
      {isLoading && transactions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: 12 }}>
          Loading transactions...
        </div>
      ) : transactions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "20px", color: "var(--text-muted)", fontSize: 12 }}>
          No bridge transactions found.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {transactions.map((tx) => {
            const isCompleted = tx.bridge_status === "COMPLETED";
            const isFailed = tx.bridge_status === "FAILED";
            const burnUrl = getExplorerUrl(tx.source_chain, tx.burn_tx_hash);
            const mintUrl = tx.mint_tx_hash ? getExplorerUrl(tx.destination_chain, tx.mint_tx_hash) : null;

            return (
              <div
                key={tx.id}
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: "8px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                {/* Top Row: Route, Amount & Status */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", background: "var(--surface-soft, rgba(0,0,0,0.04))", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 6 }}>
                      {cleanChainName(tx.source_chain)}
                    </span>
                    <span style={{ fontSize: 10.5, color: "var(--text-muted)" }}>
                      -&gt;
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", background: "var(--surface-soft, rgba(0,0,0,0.04))", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 6 }}>
                      {cleanChainName(tx.destination_chain)}
                    </span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>
                      {tx.amount} {tx.token_symbol || "USDC"}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "1px 6px",
                        borderRadius: 6,
                        background: "var(--surface-soft, rgba(0,0,0,0.04))",
                        border: "1px solid var(--border)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {isCompleted ? "Completed" : isFailed ? "Failed" : "Processing"}
                    </span>
                  </div>
                </div>

                {/* Bottom Row: User, Timestamp, Explorer */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10.5, color: "var(--text-muted)", paddingTop: 4, borderTop: "1px solid var(--border-soft)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span>User: <strong style={{ color: "var(--text-primary)", fontFamily: "monospace" }}>{formatAddress(tx.wallet_address)}</strong></span>
                    <span>•</span>
                    <span>{timeAgo(tx.created_at)}</span>
                  </div>

                  {(burnUrl || mintUrl) && (
                    <a
                      href={(mintUrl || burnUrl)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        color: "var(--text-primary)",
                        textDecoration: "underline",
                        fontWeight: 600,
                        fontSize: 10.5,
                      }}
                    >
                      Explorer
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination Controls (Compact) */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          Page {page} of {totalPages} ({totalCount} total)
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={() => fetchFeed(page - 1)}
            disabled={page <= 1 || isLoading}
            style={{
              background: page <= 1 ? "transparent" : "var(--surface-soft, rgba(0, 0, 0, 0.04))",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 10px",
              color: page <= 1 ? "var(--text-muted)" : "var(--text-primary)",
              fontSize: 11,
              fontWeight: 600,
              cursor: page <= 1 || isLoading ? "not-allowed" : "pointer",
              opacity: page <= 1 ? 0.4 : 1,
            }}
          >
            Prev
          </button>

          <button
            onClick={() => fetchFeed(page + 1)}
            disabled={page >= totalPages || isLoading}
            style={{
              background: page >= totalPages ? "transparent" : "var(--surface-soft, rgba(0, 0, 0, 0.04))",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "4px 10px",
              color: page >= totalPages ? "var(--text-muted)" : "var(--text-primary)",
              fontSize: 11,
              fontWeight: 600,
              cursor: page >= totalPages || isLoading ? "not-allowed" : "pointer",
              opacity: page >= totalPages ? 0.4 : 1,
            }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
