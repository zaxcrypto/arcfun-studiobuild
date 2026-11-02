"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type EnvironmentMode = "testnet" | "mainnet";

export interface EnvironmentFeatures {
  bridgeEnabled: boolean;
  recoveryEnabled: boolean;
  historyEnabled: boolean;
  faucetEnabled: boolean;
  deployTokenEnabled: boolean;
}

const TESTNET_FEATURES: EnvironmentFeatures = {
  bridgeEnabled: true,
  recoveryEnabled: true,
  historyEnabled: true,
  faucetEnabled: true,
  deployTokenEnabled: true,
};

const MAINNET_FEATURES: EnvironmentFeatures = {
  bridgeEnabled: true,
  recoveryEnabled: false,
  historyEnabled: true,
  faucetEnabled: false,
  deployTokenEnabled: false,
};

interface NetworkReadinessState {
  mainnetEnabled: boolean;
  mainnetReady: boolean;
  isAdmin?: boolean;
  missing: string[];
  isLoading: boolean;
}

interface EnvironmentContextType {
  mode: EnvironmentMode;
  features: EnvironmentFeatures;
  setMode: (mode: EnvironmentMode) => void;
  readiness: NetworkReadinessState;
  switchNetwork: (newMode: EnvironmentMode) => { success: boolean; reason?: string };
  checkAddressReadiness: (address?: string) => Promise<void>;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(undefined);

export function EnvironmentProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<EnvironmentMode>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("arcfun-env") as EnvironmentMode;
      if (saved === "testnet" || saved === "mainnet") {
        return saved;
      }
    }
    return "testnet";
  });

  const [readiness, setReadiness] = useState<NetworkReadinessState>({
    mainnetEnabled: false,
    mainnetReady: false,
    missing: [],
    isLoading: true,
  });

  const checkAddressReadiness = useCallback(async (walletAddr?: string) => {
    try {
      const url = walletAddr ? `/api/network/mode?address=${walletAddr}` : "/api/network/mode";
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const enabled = Boolean(data.mainnetEnabled);
        const ready = Boolean(data.mainnetReady);
        const isUserAdmin = Boolean(data.isAdmin);

        setReadiness({
          mainnetEnabled: enabled,
          mainnetReady: ready,
          isAdmin: isUserAdmin,
          missing: Array.isArray(data.missing) ? data.missing : [],
          isLoading: false,
        });

        // Fail-closed fallback only if user is NOT admin and mainnet is not globally enabled
        const saved = typeof window !== "undefined" ? (localStorage.getItem("arcfun-env") as EnvironmentMode) : null;
        if (saved === "mainnet" && !enabled && !isUserAdmin) {
          setModeState("testnet");
          if (typeof window !== "undefined") localStorage.setItem("arcfun-env", "testnet");
        }
      }
    } catch (err) {
      console.warn("[NetworkContext] Readiness check failed, falling back to testnet.", err);
    }
  }, []);

  // Initial mount check & live sync on window focus / periodic timer
  useEffect(() => {
    checkAddressReadiness();
    const handleFocus = () => {
      checkAddressReadiness();
    };
    window.addEventListener("focus", handleFocus);
    const interval = setInterval(() => {
      checkAddressReadiness();
    }, 10_000);

    return () => {
      window.removeEventListener("focus", handleFocus);
      clearInterval(interval);
    };
  }, [checkAddressReadiness]);

  const switchNetwork = useCallback((newMode: EnvironmentMode): { success: boolean; reason?: string } => {
    if (newMode === "mainnet") {
      // Allow switch if mainnet is enabled OR user is admin
      if (!readiness.mainnetEnabled && !readiness.isAdmin) {
        return { success: false, reason: "ArcFun Mainnet is currently disabled globally by administrator." };
      }
      if (!readiness.mainnetReady && readiness.missing.length > 0) {
        return { success: false, reason: `ArcFun Mainnet is not ready. Missing configuration: ${readiness.missing.join(", ")}` };
      }
    }

    setModeState(newMode);
    if (typeof window !== "undefined") localStorage.setItem("arcfun-env", newMode);
    return { success: true };
  }, [readiness]);

  const setMode = useCallback((newMode: EnvironmentMode) => {
    const res = switchNetwork(newMode);
    if (!res.success && typeof window !== "undefined") {
      console.warn(`[NetworkContext] Refused network switch to ${newMode}: ${res.reason}`);
    }
  }, [switchNetwork]);

  const features = mode === "mainnet" ? MAINNET_FEATURES : TESTNET_FEATURES;

  return (
    <EnvironmentContext.Provider value={{ mode, setMode, features, readiness, switchNetwork, checkAddressReadiness }}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment() {
  const context = useContext(EnvironmentContext);
  if (context === undefined) {
    throw new Error("useEnvironment must be used within an EnvironmentProvider");
  }
  return context;
}
