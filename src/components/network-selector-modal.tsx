"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAccount, useSwitchChain } from "wagmi";
import { X, Check, Loader2, AlertTriangle } from "lucide-react";
import { useEnvironment } from "@/contexts/EnvironmentContext";

interface NetworkSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
  isUnsupported?: boolean;
}

// Chain Icon Resolver
export function getChainIcon(chainId: number, chainName?: string): string {
  const name = (chainName || "").toLowerCase();
  if (chainId === 146 || chainId === 14601 || chainId === 57054 || name.includes("sonic")) return "/icons/sonic.png";
  if (chainId === 5042 || chainId === 5042002 || name.includes("arc")) return "/arc-logo.png";
  if (chainId === 8453 || chainId === 84532 || name.includes("base")) return "/icons/base.svg";
  if (chainId === 42161 || chainId === 421614 || name.includes("arbitrum")) return "/icons/arbitrum.svg";
  if (chainId === 1 || chainId === 11155111 || name.includes("ethereum") || name.includes("sepolia")) return "/icons/ethereum.svg";
  if (chainId === 10 || chainId === 11155420 || name.includes("optimism") || name.includes("op mainnet")) return "/icons/optimism.svg";
  if (chainId === 137 || chainId === 80002 || name.includes("polygon")) return "/icons/polygon.png";
  if (chainId === 43114 || chainId === 43113 || name.includes("avalanche")) return "/icons/avalanche.png";
  if (chainId === 57073 || chainId === 763373 || name.includes("ink")) return "/icons/ink.svg";
  if (chainId === 130 || chainId === 1301 || name.includes("unichain")) return "/icons/unichain.svg";
  if (chainId === 59144 || chainId === 59141 || name.includes("linea")) return "/icons/linea.svg";
  if (chainId === 10143 || name.includes("monad")) return "/icons/monad.svg";
  if (chainId === 1439 || name.includes("injective")) return "/icons/injective.png";
  if (chainId === 998 || name.includes("hyperevm")) return "/icons/hyperevm.png";
  if (chainId === 4663 || name.includes("robinhood")) return "/icons/robinhood.png";
  if (chainId === 1952 || name.includes("xlayer")) return "/icons/xlayer.png";
  return "/globe.svg";
}

// Chain Display Name Formatter
function formatChainLabel(name: string): string {
  return name
    .replace(" Mainnet", "")
    .replace(" Sepolia", "")
    .replace(" Testnet", "")
    .replace(" Fuji", "");
}

export function NetworkSelectorModal({
  isOpen,
  onClose,
  anchorRef,
  isUnsupported = false,
}: NetworkSelectorModalProps) {
  const [mounted, setMounted] = useState(false);
  const [switchingChainId, setSwitchingChainId] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);

  const { chainId: currentChainId } = useAccount();
  const { chains, switchChainAsync } = useSwitchChain();
  const { mode } = useEnvironment();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Compute anchor positioning for desktop floating dropdown
  useEffect(() => {
    if (!isOpen || !anchorRef?.current) {
      setCoords(null);
      return;
    }

    const updatePosition = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      const right = Math.max(16, window.innerWidth - rect.right);
      const top = rect.bottom + 8;
      setCoords({ top, right });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, anchorRef]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  const handleSelectChain = async (targetChainId: number) => {
    if (targetChainId === currentChainId && !isUnsupported) {
      onClose();
      return;
    }
    try {
      setSwitchingChainId(targetChainId);
      if (switchChainAsync) {
        await switchChainAsync({ chainId: targetChainId });
      }
      onClose();
    } catch (err: any) {
      console.warn("[NetworkSelector] Failed to switch chain:", err?.message || err);
    } finally {
      setSwitchingChainId(null);
    }
  };

  if (!mounted) return null;

  // Filter chains based on current app environment mode (Mainnet vs Testnet)
  const isMainnetMode = mode === "mainnet";
  const displayedChains = chains.filter(c => {
    const id = c.id;
    const name = c.name.toLowerCase();
    const isTestnet =
      name.includes("testnet") ||
      name.includes("sepolia") ||
      name.includes("fuji") ||
      name.includes("amoy") ||
      id === 5042002 ||
      id === 11155111 ||
      id === 421614 ||
      id === 84532 ||
      id === 59141 ||
      id === 14601 ||
      id === 10143 ||
      id === 1301 ||
      id === 763373 ||
      id === 11155420 ||
      id === 43113 ||
      id === 1439 ||
      id === 998 ||
      id === 80002 ||
      id === 1952;

    return isMainnetMode ? !isTestnet : isTestnet;
  });

  const isDesktopAnchored = Boolean(coords && window.innerWidth >= 640);

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Scoped CSS for Sleek Custom Thin Dark Scrollbar */}
          <style>{`
            .network-chain-scroll {
              scrollbar-width: thin;
              scrollbar-color: rgba(0, 0, 0, 0.45) transparent;
            }
            .network-chain-scroll::-webkit-scrollbar {
              width: 4px;
            }
            .network-chain-scroll::-webkit-scrollbar-track {
              background: transparent;
            }
            .network-chain-scroll::-webkit-scrollbar-thumb {
              background: rgba(0, 0, 0, 0.45);
              border-radius: 99px;
            }
            .network-chain-scroll::-webkit-scrollbar-thumb:hover {
              background: rgba(0, 0, 0, 0.7);
            }
            .dark .network-chain-scroll {
              scrollbar-color: rgba(255, 255, 255, 0.28) transparent;
            }
            .dark .network-chain-scroll::-webkit-scrollbar-thumb {
              background: rgba(255, 255, 255, 0.28);
            }
            .dark .network-chain-scroll::-webkit-scrollbar-thumb:hover {
              background: rgba(255, 255, 255, 0.45);
            }
          `}</style>

          {/* Clean Transparent Click-Away Overlay (No Background Blur, No Greying) */}
          <div
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 99990,
              background: "transparent",
            }}
          />

          {/* Modal / Dropdown Card */}
          <div
            style={{
              position: "fixed",
              zIndex: 99999,
              ...(isDesktopAnchored
                ? {
                    top: coords?.top ?? 70,
                    right: coords?.right ?? 16,
                  }
                : {
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "16px",
                    pointerEvents: "none",
                  }),
            }}
          >
            <motion.div
              initial={
                isDesktopAnchored
                  ? { opacity: 0, y: -10, scale: 0.96 }
                  : { opacity: 0, scale: 0.95, y: 16 }
              }
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={
                isDesktopAnchored
                  ? { opacity: 0, y: -8, scale: 0.96 }
                  : { opacity: 0, scale: 0.95, y: 16 }
              }
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              style={{
                pointerEvents: "auto",
                width: "100%",
                maxWidth: 320,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 20,
                boxShadow:
                  "0 20px 48px -6px rgba(0, 0, 0, 0.32), 0 0 0 1px var(--border-soft)",
                backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)",
                padding: "14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                overflow: "hidden",
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingBottom: 2,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span
                    style={{
                      fontSize: 15,
                      fontWeight: 700,
                      color: "var(--text-primary)",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    Switch Networks
                  </span>
                  {isUnsupported && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 7px",
                        borderRadius: 99,
                        background: "rgba(239, 68, 68, 0.12)",
                        color: "#ef4444",
                        border: "1px solid rgba(239, 68, 68, 0.25)",
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <AlertTriangle size={10} />
                      Wrong
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    border: "none",
                    background: "var(--surface-soft, rgba(128, 128, 128, 0.08))",
                    color: "var(--text-muted)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                  className="hover:scale-105 active:scale-95"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Chain List Container with Custom Thin Dark Scrollbar */}
              <div
                className="network-chain-scroll"
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  maxHeight: 300,
                  overflowY: "auto",
                  paddingRight: 4,
                  marginRight: -2,
                }}
              >
                {displayedChains.map((chain) => {
                  const isCurrent = currentChainId === chain.id;
                  const isSwitching = switchingChainId === chain.id;
                  const iconSrc = getChainIcon(chain.id, chain.name);
                  const displayLabel = formatChainLabel(chain.name);

                  return (
                    <button
                      key={chain.id}
                      type="button"
                      disabled={isSwitching}
                      onClick={() => handleSelectChain(chain.id)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "8px 10px",
                        borderRadius: 14,
                        border: isCurrent
                          ? "1px solid var(--border)"
                          : "1px solid transparent",
                        background: isCurrent
                          ? "var(--surface-soft, rgba(128, 128, 128, 0.08))"
                          : "transparent",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                        textAlign: "left",
                        userSelect: "none",
                      }}
                      className="hover:bg-black/5 dark:hover:bg-white/5 active:scale-[0.99]"
                    >
                      {/* Logo with rounded border */}
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          overflow: "hidden",
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "var(--surface-soft, rgba(128, 128, 128, 0.06))",
                          boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
                        }}
                      >
                        <img
                          src={iconSrc}
                          alt={chain.name}
                          style={{
                            width: 26,
                            height: 26,
                            objectFit: "cover",
                          }}
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = "/globe.svg";
                          }}
                        />
                      </div>

                      {/* Name */}
                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                          display: "flex",
                          flexDirection: "column",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13.5,
                            fontWeight: isCurrent ? 700 : 500,
                            color: "var(--text-primary)",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {displayLabel}
                        </span>
                      </div>

                      {/* Status Indicator */}
                      <div
                        style={{
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 20,
                          height: 20,
                        }}
                      >
                        {isSwitching ? (
                          <Loader2
                            size={14}
                            className="animate-spin text-blue-500"
                          />
                        ) : isCurrent ? (
                          <div
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: "50%",
                              background: "#22c55e",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Check size={11} color="#ffffff" strokeWidth={3} />
                          </div>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body
  );
}
