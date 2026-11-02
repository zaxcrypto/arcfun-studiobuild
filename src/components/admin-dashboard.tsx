/* eslint-disable */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { supabase } from "@/lib/supabase";
import { LiveFeedHistoryView } from "./live-bridge-feed";
import { CircleGatewayAdminBalances } from "./circle-gateway-admin-balances";
import { RelayerGasManagement } from "./relayer-gas-admin";

export function AdminDashboard() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // Active Sub-Section: "control" | "gas" | "gateway" | "transactions"
  const [activeSection, setActiveSection] = useState<"control" | "gas" | "gateway" | "transactions">("control");

  // Access Control State
  const [togglingMode, setTogglingMode] = useState<string | null>(null);
  const [accessSettings, setAccessSettings] = useState<any>(null);

  // CCTP Gas Eligibility Settings State
  const [minRelayerBalanceInput, setMinRelayerBalanceInput] = useState<string>("2.00");
  const [maxSponsoredFeeInput, setMaxSponsoredFeeInput] = useState<string>("0.10");
  const [savedGasSettings, setSavedGasSettings] = useState<{ min_relayer_balance_usd: number; max_sponsored_claim_fee_usd: number } | null>(null);
  const [gasSettingsLoading, setGasSettingsLoading] = useState<boolean>(false);
  const [savingGasField, setSavingGasField] = useState<"min_balance" | "max_fee" | null>(null);
  const [gasFeedback, setGasFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Fetch CCTP Gas Settings (only when on control section)
  const fetchGasSettings = useCallback(async () => {
    try {
      setGasSettingsLoading(true);
      // Try backend endpoint first (authenticated via server-side service role)
      const res = await fetch("/api/admin/cctp-gas-settings");
      if (res.ok) {
        const json = await res.json();
        if (json.settings) {
          const s = {
            min_relayer_balance_usd: Number(json.settings.min_relayer_balance_usd),
            max_sponsored_claim_fee_usd: Number(json.settings.max_sponsored_claim_fee_usd),
          };
          setSavedGasSettings(s);
          setMinRelayerBalanceInput(s.min_relayer_balance_usd.toFixed(2));
          setMaxSponsoredFeeInput(s.max_sponsored_claim_fee_usd.toFixed(2));
          return;
        }
      }

      // Fallback to client query if endpoint fails
      const { data, error } = await supabase
        .from("cctp_gas_settings")
        .select("min_relayer_balance_usd, max_sponsored_claim_fee_usd")
        .eq("id", "default")
        .maybeSingle();

      if (data && !error) {
        const s = {
          min_relayer_balance_usd: Number(data.min_relayer_balance_usd),
          max_sponsored_claim_fee_usd: Number(data.max_sponsored_claim_fee_usd),
        };
        setSavedGasSettings(s);
        setMinRelayerBalanceInput(s.min_relayer_balance_usd.toFixed(2));
        setMaxSponsoredFeeInput(s.max_sponsored_claim_fee_usd.toFixed(2));
      } else {
        setSavedGasSettings((prev) => prev || { min_relayer_balance_usd: 2.0, max_sponsored_claim_fee_usd: 0.1 });
      }
    } catch (e) {
      console.warn("Failed to fetch CCTP gas settings:", e);
    } finally {
      setGasSettingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "control") {
      fetchGasSettings();
    }
  }, [activeSection, fetchGasSettings]);

  const handleSaveGasSetting = async (field: "min_balance" | "max_fee") => {
    if (!address) {
      setGasFeedback({ type: "error", message: "Please connect an authorized admin wallet." });
      return;
    }

    setSavingGasField(field);
    setGasFeedback(null);

    try {
      const payload: { min_relayer_balance_usd?: number; max_sponsored_claim_fee_usd?: number } = {};

      if (field === "min_balance") {
        const val = parseFloat(minRelayerBalanceInput);
        if (isNaN(val) || !isFinite(val) || val < 0) {
          throw new Error("Invalid Minimum Relayer Balance. Must be a non-negative number.");
        }
        payload.min_relayer_balance_usd = Math.round(val * 10000) / 10000;
      } else {
        const val = parseFloat(maxSponsoredFeeInput);
        if (isNaN(val) || !isFinite(val) || val < 0) {
          throw new Error("Invalid Maximum Claim Fee. Must be a non-negative number.");
        }
        payload.max_sponsored_claim_fee_usd = Math.round(val * 10000) / 10000;
      }

      const res = await dispatchAdminAction("update_cctp_gas_settings", "cctp_gas_settings", payload);

      if (res?.settings) {
        const s = {
          min_relayer_balance_usd: Number(res.settings.min_relayer_balance_usd),
          max_sponsored_claim_fee_usd: Number(res.settings.max_sponsored_claim_fee_usd),
        };
        setSavedGasSettings(s);
        setMinRelayerBalanceInput(s.min_relayer_balance_usd.toFixed(2));
        setMaxSponsoredFeeInput(s.max_sponsored_claim_fee_usd.toFixed(2));
      } else {
        if (field === "min_balance" && payload.min_relayer_balance_usd !== undefined) {
          setSavedGasSettings((prev) => ({
            min_relayer_balance_usd: payload.min_relayer_balance_usd!,
            max_sponsored_claim_fee_usd: prev?.max_sponsored_claim_fee_usd ?? 0.1,
          }));
          setMinRelayerBalanceInput(payload.min_relayer_balance_usd.toFixed(2));
        } else if (field === "max_fee" && payload.max_sponsored_claim_fee_usd !== undefined) {
          setSavedGasSettings((prev) => ({
            min_relayer_balance_usd: prev?.min_relayer_balance_usd ?? 2.0,
            max_sponsored_claim_fee_usd: payload.max_sponsored_claim_fee_usd!,
          }));
          setMaxSponsoredFeeInput(payload.max_sponsored_claim_fee_usd.toFixed(2));
        }
      }

      setGasFeedback({
        type: "success",
        message: `Updated ${field === "min_balance" ? "Relayer Balance" : "Claim Fee"} successfully.`
      });
    } catch (e: any) {
      console.error("Save gas setting error:", e);
      setGasFeedback({
        type: "error",
        message: e.message || "Failed to save setting."
      });
    } finally {
      setSavingGasField(null);
    }
  };

  const dispatchAdminAction = async (action: string, targetId: string, payload: any) => {
    if (!address) throw new Error("Wallet not connected");
    const timestamp = Date.now();
    const nonce = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `nonce-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const canonicalPayload = payload ? JSON.stringify(payload) : "{}";
    const message = `ArcFun Admin Action: ${action} on ${targetId} at ${timestamp} [nonce:${nonce}] [payload:${canonicalPayload}]`;

    const signature = await signMessageAsync({ message });

    const res = await fetch("/api/admin/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        admin_wallet: address,
        action,
        target_id: targetId,
        payload,
        project_name: "ArcFun Admin Dashboard",
        signature,
        timestamp,
        nonce
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Admin action failed (${res.status})`);
    }

    return await res.json();
  };

  useEffect(() => {
    supabase.from("onchain_access_settings").select("*").then(({ data }) => {
      if (data) {
        const parsed: any = {};
        data.forEach((row: any) => {
          if (row.module === "bridge") parsed.bridgeMode = row.mode;
          if (row.module === "bridge_evm_to_sui") parsed.evmToSuiMode = row.mode;
          if (row.module === "bridge_sui_to_evm") parsed.suiToEvmMode = row.mode;
          if (row.module === "bridge_solana_to_sui") parsed.solanaToSuiMode = row.mode;
          if (row.module === "bridge_sui_to_solana") parsed.suiToSolanaMode = row.mode;
        });
        setAccessSettings(parsed);
      }
    });
  }, [address]);

  const handleBridgeRouteToggle = async (
    module: "bridge_evm_to_sui" | "bridge_sui_to_evm" | "bridge_solana_to_sui" | "bridge_sui_to_solana",
    currentMode: string
  ) => {
    if (!address) return;
    const newMode = currentMode === "paused" ? "active" : "paused";
    const stateKey =
      module === "bridge_evm_to_sui" ? "evmToSuiMode" :
      module === "bridge_sui_to_evm" ? "suiToEvmMode" :
      module === "bridge_solana_to_sui" ? "solanaToSuiMode" : "suiToSolanaMode";

    setTogglingMode(`${module}-${newMode}`);
    const prevMode = accessSettings?.[stateKey] || "active";

    setAccessSettings((prev: any) => ({
      ...prev,
      [stateKey]: newMode
    }));

    try {
      await dispatchAdminAction("update_onchain_access_setting", module, { module, mode: newMode });
    } catch (e: any) {
      setAccessSettings((prev: any) => ({
        ...prev,
        [stateKey]: prevMode
      }));
      console.error("Failed to update bridge route toggle:", e);
    } finally {
      setTogglingMode(null);
    }
  };

  const handleModeChange = async (module: "bridge", mode: string) => {
    if (!address) return;

    setTogglingMode(`${module}-${mode}`);
    const previousMode = accessSettings?.bridgeMode;
    setAccessSettings((prev: any) => ({
      ...prev,
      bridgeMode: mode
    }));

    try {
      await dispatchAdminAction("update_onchain_access_setting", module, { module, mode });
    } catch (e: any) {
      setAccessSettings((prev: any) => ({
        ...prev,
        bridgeMode: previousMode
      }));
      if (!e?.message?.includes("User rejected")) {
        console.error("Failed to update mode:", e);
      }
    } finally {
      setTogglingMode(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1000, margin: "0 auto", width: "100%" }}>

      {/* ── COMPACT SEGMENTED PILL BAR ── */}
      <div
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          background: "var(--surface-soft, rgba(0,0,0,0.03))",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 3,
          gap: 4,
          flexWrap: "wrap",
        }}
      >
        {[
          { id: "control" as const, label: "Controls & Policies" },
          { id: "gas" as const, label: "Backend Gas & Fees" },
          { id: "gateway" as const, label: "Gateway Treasury" },
          { id: "transactions" as const, label: "Transactions" },
        ].map((tab) => {
          const isSelected = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSection(tab.id)}
              style={{
                padding: "5px 13px",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all 0.12s ease",
                background: isSelected ? "#18181b" : "transparent",
                color: isSelected ? "#ffffff" : "var(--text-muted)",
                border: "none",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── SECTION 1: BRIDGE CONTROLS & GAS (COMPACT) ── */}
      {activeSection === "control" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Bridge Access Mode */}
          <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>Bridge Access Mode</span>
            </div>

            <div style={{ padding: "12px 14px" }}>
              {(() => {
                const currentMode = accessSettings?.bridgeMode || "Open To Everyone";
                const modes = ["Open To Everyone", "Admin Only"];
                return (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {modes.map((mode) => {
                      const isSelected = currentMode === mode;
                      const isUpdating = togglingMode === `bridge-${mode}`;

                      return (
                        <button
                          key={mode}
                          onClick={() => handleModeChange("bridge", mode)}
                          disabled={togglingMode !== null}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "7px 14px",
                            borderRadius: 8,
                            border: isSelected ? "1px solid var(--text-primary)" : "1px solid var(--border)",
                            background: isSelected ? "var(--surface-soft, rgba(0,0,0,0.06))" : "transparent",
                            cursor: togglingMode !== null ? "not-allowed" : "pointer",
                            fontSize: 12,
                            fontWeight: isSelected ? 600 : 500,
                            color: isSelected ? "var(--text-primary)" : "var(--text-muted)",
                            transition: "all 0.12s ease",
                          }}
                        >
                          <div
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              border: isSelected ? "4px solid var(--text-primary)" : "1.5px solid var(--text-muted)",
                              background: "transparent",
                              flexShrink: 0,
                            }}
                          />
                          <span>{mode} {isUpdating ? "(...)" : ""}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* Bridge Route Control */}
          <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>Route Controls</span>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--text-muted)", background: "var(--surface-soft, rgba(0,0,0,0.04))", padding: "2px 8px", borderRadius: 6, border: "1px solid var(--border)" }}>
                Bypass Active
              </span>
            </div>

            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                {
                  id: "bridge_evm_to_sui" as const,
                  label: "EVM to Sui",
                  desc: "EVM networks to Sui Testnet",
                  stateKey: "evmToSuiMode"
                },
                {
                  id: "bridge_sui_to_evm" as const,
                  label: "Sui to EVM",
                  desc: "Sui Testnet to EVM networks",
                  stateKey: "suiToEvmMode"
                },
                {
                  id: "bridge_solana_to_sui" as const,
                  label: "Solana to Sui",
                  desc: "Solana Devnet to Sui Testnet",
                  stateKey: "solanaToSuiMode"
                },
                {
                  id: "bridge_sui_to_solana" as const,
                  label: "Sui to Solana",
                  desc: "Sui Testnet to Solana Devnet",
                  stateKey: "suiToSolanaMode"
                }
              ].map((route) => {
                const currentMode = accessSettings?.[route.stateKey] || "active";
                const isPaused = currentMode === "paused";
                const isUpdating = togglingMode?.startsWith(route.id);

                return (
                  <div
                    key={route.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      background: "var(--surface-soft, rgba(0,0,0,0.02))",
                      borderRadius: 10,
                      padding: "9px 12px",
                      border: "1px solid var(--border)",
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)" }}>
                          {route.label}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            padding: "1px 6px",
                            borderRadius: 6,
                            background: "var(--surface)",
                            color: isPaused ? "var(--text-muted)" : "var(--text-primary)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          {isPaused ? "Paused" : "Active"}
                        </span>
                      </div>
                      <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, marginBottom: 0 }}>
                        {route.desc}
                      </p>
                    </div>

                    <button
                      onClick={() => handleBridgeRouteToggle(route.id, currentMode)}
                      disabled={isUpdating}
                      style={{
                        padding: "5px 12px",
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 11.5,
                        cursor: isUpdating ? "not-allowed" : "pointer",
                        transition: "all 0.12s ease",
                        background: isPaused ? "#18181b" : "var(--surface-soft, rgba(0,0,0,0.05))",
                        color: isPaused ? "#ffffff" : "var(--text-primary)",
                        border: isPaused ? "1px solid #18181b" : "1px solid var(--border)",
                      }}
                    >
                      {isUpdating ? "..." : isPaused ? "Enable" : "Pause"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* CCTP Gas Settings */}
          <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text-primary)" }}>CCTP Gas Thresholds</span>
              <button
                onClick={fetchGasSettings}
                disabled={gasSettingsLoading}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border)",
                  color: "var(--text-muted)",
                  padding: "3px 10px",
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: gasSettingsLoading ? "not-allowed" : "pointer",
                }}
              >
                {gasSettingsLoading ? "..." : "Refresh"}
              </button>
            </div>

            <div style={{ padding: "12px 14px" }}>
              {gasFeedback && (
                <div
                  style={{
                    padding: "6px 10px",
                    borderRadius: 8,
                    fontSize: 11.5,
                    marginBottom: 10,
                    background: "var(--surface-soft, rgba(0,0,0,0.04))",
                    border: "1px solid var(--border)",
                    color: "var(--text-primary)",
                  }}
                >
                  {gasFeedback.message}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                {/* Setting 1: Min Relayer Balance */}
                <div style={{ background: "var(--surface-soft, rgba(0,0,0,0.02))", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                      Min Relayer Balance
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", background: "var(--surface)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 6 }}>
                      ${savedGasSettings ? Number(savedGasSettings.min_relayer_balance_usd).toFixed(2) : "2.00"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={minRelayerBalanceInput}
                      onChange={(e) => setMinRelayerBalanceInput(e.target.value)}
                      placeholder="2.00"
                      style={{
                        flex: 1,
                        padding: "5px 8px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        color: "var(--text-primary)",
                        fontSize: 12,
                        fontWeight: 600,
                        height: 30,
                      }}
                    />
                    <button
                      onClick={() => handleSaveGasSetting("min_balance")}
                      disabled={savingGasField === "min_balance"}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 11.5,
                        height: 30,
                        border: "1px solid #18181b",
                        cursor: savingGasField === "min_balance" ? "not-allowed" : "pointer",
                        background: "#18181b",
                        color: "#ffffff",
                      }}
                    >
                      {savingGasField === "min_balance" ? "..." : "Save"}
                    </button>
                  </div>
                </div>

                {/* Setting 2: Max Sponsored Fee */}
                <div style={{ background: "var(--surface-soft, rgba(0,0,0,0.02))", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                      Max Sponsored Fee
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", background: "var(--surface)", border: "1px solid var(--border)", padding: "1px 6px", borderRadius: 6 }}>
                      ${savedGasSettings ? Number(savedGasSettings.max_sponsored_claim_fee_usd).toFixed(2) : "0.10"}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={maxSponsoredFeeInput}
                      onChange={(e) => setMaxSponsoredFeeInput(e.target.value)}
                      placeholder="0.10"
                      style={{
                        flex: 1,
                        padding: "5px 8px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        color: "var(--text-primary)",
                        fontSize: 12,
                        fontWeight: 600,
                        height: 30,
                      }}
                    />
                    <button
                      onClick={() => handleSaveGasSetting("max_fee")}
                      disabled={savingGasField === "max_fee"}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 8,
                        fontWeight: 600,
                        fontSize: 11.5,
                        height: 30,
                        border: "1px solid #18181b",
                        cursor: savingGasField === "max_fee" ? "not-allowed" : "pointer",
                        background: "#18181b",
                        color: "#ffffff",
                      }}
                    >
                      {savingGasField === "max_fee" ? "..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── SECTION 2: BACKEND GAS & FEES (Lazy Loaded Only When Active) ── */}
      {activeSection === "gas" && (
        <RelayerGasManagement />
      )}

      {/* ── SECTION 3: GATEWAY TREASURY (Lazy Loaded Only When Active) ── */}
      {activeSection === "gateway" && (
        <CircleGatewayAdminBalances />
      )}

      {/* ── SECTION 4: BRIDGE TRANSACTIONS (Lazy Loaded Only When Active) ── */}
      {activeSection === "transactions" && (
        <div style={{ background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)", overflow: "hidden", padding: "14px 16px" }}>
          <LiveFeedHistoryView />
        </div>
      )}
    </div>
  );
}
