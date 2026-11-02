"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useEnvironment } from "@/contexts/EnvironmentContext";

interface ChainGasBalance {
  chain: string;
  symbol: string;
  balance: string;
  usdValue: string;
  status: "HEALTHY" | "LOW" | "CRITICAL";
  lastUpdated: string;
  error?: string;
}

export function RelayerGasManagement() {
  const { mode } = useEnvironment();
  const [evmAddress, setEvmAddress] = useState<string>("");
  const [stellarAddress, setStellarAddress] = useState<string>("");
  const [solAddress, setSolAddress] = useState<string>("");
  const [balances, setBalances] = useState<ChainGasBalance[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshingChain, setRefreshingChain] = useState<string | null>(null);
  const [copiedEvm, setCopiedEvm] = useState(false);
  const [copiedStellar, setCopiedStellar] = useState(false);
  const [copiedSol, setCopiedSol] = useState(false);

  const fetchAllBalances = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/relayer-balances?mode=${mode}`);
      const data = await res.json();
      if (data.success) {
        setEvmAddress(data.evmAddress || "");
        setStellarAddress(data.stellarAddress || "");
        setSolAddress(data.solAddress || "");
        setBalances(data.balances || []);
      }
    } catch (err) {
      console.error("Failed to fetch relayer balances:", err);
    } finally {
      setLoading(false);
    }
  }, [mode]);

  const fetchSingleChainBalance = async (chainName: string) => {
    setRefreshingChain(chainName);
    try {
      const res = await fetch("/api/admin/relayer-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain: chainName, mode })
      });
      const data = await res.json();
      if (data.success && data.balance) {
        setBalances(prev => prev.map(b => b.chain === chainName ? data.balance : b));
      }
    } catch (err) {
      console.error(`Failed to refresh balance for ${chainName}:`, err);
    } finally {
      setRefreshingChain(null);
    }
  };

  useEffect(() => {
    fetchAllBalances();
  }, [fetchAllBalances]);

  const copyToClipboard = (text: string, type: "evm" | "stellar" | "sol") => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (type === "stellar") {
      setCopiedStellar(true);
      setTimeout(() => setCopiedStellar(false), 2000);
    } else if (type === "sol") {
      setCopiedSol(true);
      setTimeout(() => setCopiedSol(false), 2000);
    } else {
      setCopiedEvm(true);
      setTimeout(() => setCopiedEvm(false), 2000);
    }
  };

  const getStatusBadge = (status: "HEALTHY" | "LOW" | "CRITICAL") => {
    switch (status) {
      case "HEALTHY":
        return (
          <span style={{
            display: "inline-block",
            padding: "2px 7px",
            fontSize: 10,
            fontWeight: 700,
            color: "var(--text-primary)",
            background: "var(--surface-soft, rgba(0,0,0,0.04))",
            border: "1px solid var(--border)",
            borderRadius: 6,
            letterSpacing: "0.03em",
          }}>
            HEALTHY
          </span>
        );
      case "LOW":
        return (
          <span style={{
            display: "inline-block",
            padding: "2px 7px",
            fontSize: 10,
            fontWeight: 700,
            color: "var(--text-primary)",
            background: "rgba(0,0,0,0.08)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            letterSpacing: "0.03em",
          }}>
            LOW GAS
          </span>
        );
      case "CRITICAL":
        return (
          <span style={{
            display: "inline-block",
            padding: "2px 7px",
            fontSize: 10,
            fontWeight: 700,
            color: "#ffffff",
            background: "#18181b",
            border: "1px solid #18181b",
            borderRadius: 6,
            letterSpacing: "0.03em",
          }}>
            CRITICAL
          </span>
        );
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
      {/* ── Top Relayer Addresses Card ──────────────────────────────────────── */}
      <div style={{
        background: "var(--surface, rgba(255,255,255,0.7))",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "14px 16px",
        boxSizing: "border-box",
        width: "100%",
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 8,
          marginBottom: 12,
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>
                Backend Relayer Gas Monitor
              </h3>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 4,
                background: mode === "mainnet" ? "#18181b" : "var(--surface-soft, rgba(0,0,0,0.05))",
                color: mode === "mainnet" ? "#ffffff" : "var(--text-muted)",
                border: "1px solid var(--border)",
                textTransform: "uppercase"
              }}>
                {mode}
              </span>
            </div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 0" }}>
              Real-time on-chain native gas reserves for auto-minting
            </p>
          </div>

          <button
            onClick={fetchAllBalances}
            disabled={loading}
            style={{
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 600,
              color: "#ffffff",
              background: "#18181b",
              border: "1px solid #18181b",
              borderRadius: 8,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "Refreshing..." : "Refresh All"}
          </button>
        </div>

        {/* Addresses Grid (Fully responsive) */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: 8,
          width: "100%",
          boxSizing: "border-box",
        }}>
          {/* EVM Address */}
          <div style={{
            padding: "8px 12px",
            background: "var(--surface-soft, rgba(0,0,0,0.02))",
            border: "1px solid var(--border)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minWidth: 0,
            boxSizing: "border-box",
          }}>
            <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                EVM Relayer Wallet
              </span>
              <div style={{
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-primary)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {evmAddress ? `${evmAddress.slice(0, 8)}...${evmAddress.slice(-6)}` : "Loading..."}
              </div>
            </div>
            {evmAddress && (
              <button
                onClick={() => copyToClipboard(evmAddress, "evm")}
                style={{
                  background: copiedEvm ? "#18181b" : "var(--surface, rgba(255,255,255,0.8))",
                  border: "1px solid var(--border)",
                  color: copiedEvm ? "#ffffff" : "var(--text-primary)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "3px 8px",
                  marginLeft: 8,
                  flexShrink: 0,
                  transition: "all 0.12s ease",
                }}
              >
                {copiedEvm ? "Copied" : "Copy"}
              </button>
            )}
          </div>

          {/* Stellar Address */}
          <div style={{
            padding: "8px 12px",
            background: "var(--surface-soft, rgba(0,0,0,0.02))",
            border: "1px solid var(--border)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minWidth: 0,
            boxSizing: "border-box",
          }}>
            <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Stellar Relayer Wallet
              </span>
              <div style={{
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-primary)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {stellarAddress ? `${stellarAddress.slice(0, 8)}...${stellarAddress.slice(-6)}` : "Loading..."}
              </div>
            </div>
            {stellarAddress && (
              <button
                onClick={() => copyToClipboard(stellarAddress, "stellar")}
                style={{
                  background: copiedStellar ? "#18181b" : "var(--surface, rgba(255,255,255,0.8))",
                  border: "1px solid var(--border)",
                  color: copiedStellar ? "#ffffff" : "var(--text-primary)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "3px 8px",
                  marginLeft: 8,
                  flexShrink: 0,
                  transition: "all 0.12s ease",
                }}
              >
                {copiedStellar ? "Copied" : "Copy"}
              </button>
            )}
          </div>

          {/* Solana Address */}
          <div style={{
            padding: "8px 12px",
            background: "var(--surface-soft, rgba(0,0,0,0.02))",
            border: "1px solid var(--border)",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minWidth: 0,
            boxSizing: "border-box",
          }}>
            <div style={{ minWidth: 0, flex: 1, overflow: "hidden" }}>
              <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Solana Relayer Wallet
              </span>
              <div style={{
                fontFamily: "monospace",
                fontSize: 11,
                fontWeight: 600,
                color: "var(--text-primary)",
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}>
                {solAddress ? `${solAddress.slice(0, 8)}...${solAddress.slice(-6)}` : "Loading..."}
              </div>
            </div>
            {solAddress && (
              <button
                onClick={() => copyToClipboard(solAddress, "sol")}
                style={{
                  background: copiedSol ? "#18181b" : "var(--surface, rgba(255,255,255,0.8))",
                  border: "1px solid var(--border)",
                  color: copiedSol ? "#ffffff" : "var(--text-primary)",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "3px 8px",
                  marginLeft: 8,
                  flexShrink: 0,
                  transition: "all 0.12s ease",
                }}
              >
                {copiedSol ? "Copied" : "Copy"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Balances Section (Cards for Mobile, Table for Desktop) ── */}
      {loading && balances.length === 0 ? (
        <div style={{
          padding: 24,
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 12,
          background: "var(--surface, rgba(255,255,255,0.7))",
          border: "1px solid var(--border)",
          borderRadius: 12,
        }}>
          Fetching on-chain gas balances across all chains...
        </div>
      ) : (
        <>
          {/* Mobile View: Compact Cards (Hidden on sm and above) */}
          <div className="block sm:hidden" style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            {balances.map((b) => {
              const isRefreshing = refreshingChain === b.chain;
              return (
                <div
                  key={b.chain}
                  style={{
                    padding: "10px 12px",
                    background: "var(--surface, rgba(255,255,255,0.7))",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    boxSizing: "border-box",
                    width: "100%",
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)" }}>
                      {b.chain}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", marginTop: 2 }}>
                      <span style={{ fontFamily: "monospace", color: "var(--text-primary)" }}>{b.balance} {b.symbol}</span>
                      <span style={{ margin: "0 5px" }}>·</span>
                      <span>~${b.usdValue}</span>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {getStatusBadge(b.status)}
                    <button
                      onClick={() => fetchSingleChainBalance(b.chain)}
                      disabled={isRefreshing || loading}
                      style={{
                        padding: "4px 9px",
                        fontSize: 11,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        background: "var(--surface-soft, rgba(0,0,0,0.04))",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        cursor: isRefreshing || loading ? "not-allowed" : "pointer",
                        transition: "all 0.12s ease",
                      }}
                    >
                      {isRefreshing ? "..." : "Sync"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop View: Clean Micro-Table (Hidden on mobile) */}
          <div className="hidden sm:block" style={{
            background: "var(--surface, rgba(255,255,255,0.7))",
            border: "1px solid var(--border)",
            borderRadius: 12,
            overflow: "hidden",
            width: "100%",
          }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: 12 }}>
                <thead>
                  <tr style={{
                    background: "rgba(0,0,0,0.03)",
                    borderBottom: "1px solid var(--border)",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--text-muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                  }}>
                    <th style={{ padding: "10px 14px" }}>Network / Chain</th>
                    <th style={{ padding: "10px 14px" }}>Native Token</th>
                    <th style={{ padding: "10px 14px" }}>Relayer Balance</th>
                    <th style={{ padding: "10px 14px" }}>Est. Value (USD)</th>
                    <th style={{ padding: "10px 14px" }}>Status</th>
                    <th style={{ padding: "10px 14px", textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => {
                    const isRefreshing = refreshingChain === b.chain;
                    return (
                      <tr key={b.chain} style={{ borderBottom: "1px solid var(--border)", transition: "background 0.1s ease" }}>
                        <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--text-primary)" }}>
                          {b.chain}
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text-muted)" }}>
                          {b.symbol}
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 700, fontFamily: "monospace", color: "var(--text-primary)" }}>
                          {b.balance} {b.symbol}
                        </td>
                        <td style={{ padding: "10px 14px", fontWeight: 600, color: "var(--text-muted)" }}>
                          ~${b.usdValue} USD
                        </td>
                        <td style={{ padding: "10px 14px" }}>
                          {getStatusBadge(b.status)}
                        </td>
                        <td style={{ padding: "10px 14px", textAlign: "right" }}>
                          <button
                            onClick={() => fetchSingleChainBalance(b.chain)}
                            disabled={isRefreshing || loading}
                            style={{
                              padding: "4px 9px",
                              fontSize: 11,
                              fontWeight: 600,
                              color: "var(--text-primary)",
                              background: "var(--surface-soft, rgba(0,0,0,0.04))",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              cursor: isRefreshing || loading ? "not-allowed" : "pointer",
                              transition: "all 0.12s ease",
                            }}
                          >
                            {isRefreshing ? "..." : "Sync"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
