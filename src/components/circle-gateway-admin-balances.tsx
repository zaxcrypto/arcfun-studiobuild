"use client";

import React, { useState, useEffect, useCallback } from "react";
import { formatUnits } from "viem";
import { useEnvironment } from "@/contexts/EnvironmentContext";
import {
  GATEWAY_DOMAINS_LIST,
  GATEWAY_MAINNET_DOMAINS_LIST,
  GATEWAY_NETWORKS,
  GATEWAY_MAINNET_NETWORKS,
  ARCFUN_FEE_TREASURY_WALLET,
  type GatewayNetworkConfig,
} from "@/config/gateway-config";
import { CircleGatewayClient } from "@/lib/bridge/gateway-client";

export function CircleGatewayAdminBalances() {
  const { mode } = useEnvironment();
  const activeDomains = mode === "mainnet" ? GATEWAY_MAINNET_DOMAINS_LIST : GATEWAY_DOMAINS_LIST;
  const activeNetworks = mode === "mainnet" ? GATEWAY_MAINNET_NETWORKS : GATEWAY_NETWORKS;

  const [gatewayBalances, setGatewayBalances] = useState<Record<number, string>>({});
  const [walletBalances, setWalletBalances] = useState<Record<number, string>>({});
  const [loadingChains, setLoadingChains] = useState<Record<number, boolean>>({});
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isCopied, setIsCopied] = useState(false);

  // ─── Fetch On-Chain USDC Balance via RPC ───────────────────────────────────
  const fetchSingleChainWalletBalance = async (network: GatewayNetworkConfig): Promise<string> => {
    try {
      if (!network.rpcUrl) return "0.00";

      // If Arc Mainnet (native USDC gas currency)
      if (network.chainId === 5042) {
        const res = await fetch(network.rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "eth_getBalance",
            params: [ARCFUN_FEE_TREASURY_WALLET, "latest"],
          }),
        });
        const json = await res.json();
        if (json.result) {
          const val = BigInt(json.result);
          return formatUnits(val, 18);
        }
        return "0.00";
      }

      if (!network.usdcAddress) return "0.00";
      const res = await fetch(network.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_call",
          params: [
            {
              to: network.usdcAddress,
              data: `0x70a08231000000000000000000000000${ARCFUN_FEE_TREASURY_WALLET.replace("0x", "")}`,
            },
            "latest",
          ],
        }),
      });
      const json = await res.json();
      if (json.result) {
        const val = BigInt(json.result);
        return formatUnits(val, 6);
      }
    } catch (err) {
      console.warn(`[Gateway Admin] Failed to fetch onchain balance for ${network.name}:`, err);
    }
    return "0.00";
  };

  // ─── Fetch All Gateway & On-Chain Balances ──────────────────────────────────
  const fetchAllBalances = useCallback(async () => {
    setIsRefreshingAll(true);
    try {
      const gwRes = mode === "testnet" ? await CircleGatewayClient.getBalances(ARCFUN_FEE_TREASURY_WALLET) : { balances: [] };
      const gwMap: Record<number, string> = {};
      (gwRes.balances || []).forEach((b) => {
        gwMap[b.domain] = parseFloat(b.balance || "0").toFixed(4);
      });
      setGatewayBalances(gwMap);

      const walletMap: Record<number, string> = {};
      await Promise.all(
        activeDomains.map(async (net) => {
          const bal = await fetchSingleChainWalletBalance(net);
          walletMap[net.domainId] = parseFloat(bal).toFixed(4);
        })
      );
      setWalletBalances(walletMap);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("[Gateway Admin] Error fetching balances:", err);
    } finally {
      setIsRefreshingAll(false);
    }
  }, [mode, activeDomains]);

  const refreshSingleChain = async (domainId: number) => {
    const net = activeNetworks[domainId];
    if (!net) return;

    setLoadingChains((prev) => ({ ...prev, [domainId]: true }));
    try {
      if (mode === "testnet") {
        const gwRes = await CircleGatewayClient.getBalances(ARCFUN_FEE_TREASURY_WALLET);
        const target = (gwRes.balances || []).find((b) => b.domain === domainId);
        if (target) {
          setGatewayBalances((prev) => ({
            ...prev,
            [domainId]: parseFloat(target.balance || "0").toFixed(4),
          }));
        }
      }

      const onchain = await fetchSingleChainWalletBalance(net);
      setWalletBalances((prev) => ({
        ...prev,
        [domainId]: parseFloat(onchain).toFixed(4),
      }));
    } catch (err) {
      console.error(`[Gateway Admin] Error refreshing ${net.name}:`, err);
    } finally {
      setLoadingChains((prev) => ({ ...prev, [domainId]: false }));
    }
  };

  useEffect(() => {
    fetchAllBalances();
  }, [fetchAllBalances]);

  const handleCopyWallet = () => {
    navigator.clipboard.writeText(ARCFUN_FEE_TREASURY_WALLET);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const totalGatewayPool = Object.values(gatewayBalances).reduce(
    (acc, val) => acc + parseFloat(val || "0"),
    0
  );

  const totalWalletOnchain = Object.values(walletBalances).reduce(
    (acc, val) => acc + parseFloat(val || "0"),
    0
  );

  const grandTotal = totalGatewayPool + totalWalletOnchain;

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      {/* ── Section Header (Compact) ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>
            {mode === "mainnet" ? "Fee Treasury Balances" : "Gateway Balances & Fee Treasury"}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "1px 6px",
              borderRadius: 4,
              background: mode === "mainnet" ? "#18181b" : "var(--surface-soft, rgba(0,0,0,0.05))",
              color: mode === "mainnet" ? "#ffffff" : "var(--text-muted)",
              border: "1px solid var(--border)",
              textTransform: "uppercase",
            }}
          >
            {mode}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 6,
              background: "var(--surface-soft, rgba(0,0,0,0.04))",
              color: "var(--text-primary)",
              border: "1px solid var(--border)",
            }}
          >
            1% Protocol Fee
          </span>
        </div>

        {/* Refresh Button (Compact) */}
        <button
          onClick={fetchAllBalances}
          disabled={isRefreshingAll}
          style={{
            background: "var(--surface-soft, rgba(0,0,0,0.04))",
            border: "1px solid var(--border)",
            color: "var(--text-primary)",
            padding: "5px 12px",
            borderRadius: 8,
            fontSize: 11.5,
            fontWeight: 600,
            cursor: isRefreshingAll ? "not-allowed" : "pointer",
            transition: "all 0.12s ease",
          }}
        >
          {isRefreshingAll ? "..." : "Refresh All"}
        </button>
      </div>

      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Treasury Wallet Info Row (Compact) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "var(--surface-soft, rgba(0,0,0,0.02))",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "6px 12px",
            flexWrap: "wrap",
            gap: 8,
            fontSize: 11.5,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "var(--text-muted)" }}>Treasury:</span>
            <span style={{ color: "var(--text-primary)", fontFamily: "monospace", fontWeight: 700 }}>
              {ARCFUN_FEE_TREASURY_WALLET}
            </span>
            <button
              onClick={handleCopyWallet}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "1px 6px",
                color: "var(--text-primary)",
                fontSize: 10.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {isCopied ? "Copied" : "Copy"}
            </button>
          </div>

          {lastUpdated && (
            <span style={{ color: "var(--text-muted)", fontSize: 10.5 }}>
              Sync: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>

        {/* ── Summary Totals Grid (Compact) ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
          }}
        >
          <div
            style={{
              background: "var(--surface-soft, rgba(0,0,0,0.02))",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 12px",
            }}
          >
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>
              Gateway Pool
            </span>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>
              {totalGatewayPool.toFixed(4)}{" "}
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>USDC</span>
            </div>
          </div>

          <div
            style={{
              background: "var(--surface-soft, rgba(0,0,0,0.02))",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 12px",
            }}
          >
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>
              On-Chain Wallet
            </span>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>
              {totalWalletOnchain.toFixed(4)}{" "}
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>USDC</span>
            </div>
          </div>

          <div
            style={{
              background: "var(--surface-soft, rgba(0,0,0,0.02))",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "9px 12px",
            }}
          >
            <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase" }}>
              Total Treasury
            </span>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginTop: 2 }}>
              {grandTotal.toFixed(4)}{" "}
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>USDC</span>
            </div>
          </div>
        </div>

        {/* ── Chain Grid (Compact) ── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 8,
          }}
        >
          {activeDomains.map((net) => {
            const gwBal = gatewayBalances[net.domainId] || "0.0000";
            const walBal = walletBalances[net.domainId] || "0.0000";
            const isLoadingThis = loadingChains[net.domainId] || isRefreshingAll;

            return (
              <div
                key={net.domainId}
                style={{
                  background: "var(--surface-soft, rgba(0,0,0,0.02))",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  padding: "9px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                      {net.name}
                    </div>
                    <div style={{ fontSize: 9.5, color: "var(--text-muted)" }}>
                      D{net.domainId} • C{net.chainId}
                    </div>
                  </div>
                  <button
                    onClick={() => refreshSingleChain(net.domainId)}
                    disabled={isLoadingThis}
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      color: "var(--text-primary)",
                      borderRadius: 6,
                      padding: "2px 6px",
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: isLoadingThis ? "not-allowed" : "pointer",
                    }}
                  >
                    {isLoadingThis ? "..." : "Sync"}
                  </button>
                </div>

                <div
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    fontSize: 10.5,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Gateway:</span>
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{gwBal} USDC</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Wallet:</span>
                    <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{walBal} USDC</span>
                  </div>
                </div>

                <a
                  href={`${net.explorerUrl}/address/${ARCFUN_FEE_TREASURY_WALLET}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontSize: 10.5,
                    color: "var(--text-primary)",
                    textDecoration: "underline",
                    fontWeight: 600,
                    textAlign: "right",
                  }}
                >
                  Explorer
                </a>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
