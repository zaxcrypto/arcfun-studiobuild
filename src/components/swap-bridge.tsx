"use client";
import "./swap-bridge.css";

import React, { useState, useCallback, useEffect, useRef, Fragment } from "react";
import { createPortal } from "react-dom";
import { useAccount, useReadContract, useWriteContract, usePublicClient, useBalance, useWatchContractEvent, useWalletClient, useChainId, useSwitchChain, useGasPrice, useEstimateGas, useConfig } from "wagmi";
import { encodeFunctionData } from "viem";
import { parseUnits, formatUnits, createPublicClient, http, fallback, parseAbiItem } from "viem";
import { ArrowUpDown, Settings, History, Activity, Loader2, CheckCircle, XCircle, ExternalLink, RefreshCw, Info, Copy, Search, Wallet, ChevronUp, ChevronDown, Lock, AlertTriangle, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Asset as StellarAsset, Operation, TransactionBuilder, Networks, Account, Horizon } from "@stellar/stellar-sdk";
import {
  CHAIN_ID_MAP, MAX_BRIDGE_AMOUNT,
  ERC20_APPROVE_ABI, USDC_ADDRESS, EURC_ADDRESS,
  getSupportedChains, TESTNET_SUPPORTED_CHAINS, MAINNET_SUPPORTED_CHAINS, isMainnetChain, isTestnetChain
} from "@/config/swap-contract";
import { FACTORY_ADDRESS } from "@/config/contracts";
import { supabase } from "@/lib/supabase";
import { useTxEngine, EngineState, Milestone } from "@/hooks/use-tx-engine";
import { useOnChainHistory } from "@/hooks/use-onchain-history";
import { TxTracker, TxTrackerRef } from "./tx-tracker";
import { RecoverManager } from "./recover-manager";
import { useTheme } from "next-themes";
import { CCTP_DOMAINS, getCctpDomains, resolveCctpDomain, CCTS_TOKEN_MANAGER_ADDRESS } from "@/lib/bridge/cctp-provider";
import { TxHistoryEntry, getTxHistory, saveTxHistory } from "@/lib/tx-history-store";
import { SlideButton } from "./slide-button";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { rateLimitedFetch } from "@/lib/rpc-queue";
import { ChainRegistry } from "@/lib/bridge/chain-registry";
import { withSolanaFailover } from "@/lib/solana-rpc";
import { withEvmFailover } from "@/lib/evm-rpc";
import { useWallet } from "@solana/wallet-adapter-react";
import { useStellar } from "@/lib/stellar-provider";
import { fetchLiveStellarUsdcBalance } from "@/lib/stellar/stellar-rpc";
import { useSuiWallet } from "@/lib/sui-provider";
import { fetchSuiUsdcBalance } from "@/lib/bridge/sui-balance";
import { useEnvironment } from "@/contexts/EnvironmentContext";
import { getWalletClient, switchChain } from "@wagmi/core";
import { tokenMetadataService } from "@/lib/tokens/TokenMetadataService";
import { LiveFeedHistoryView } from "@/components/live-bridge-feed";
import { LiveToastNotification } from "@/components/live-toast-notification";
import { TokenPriceChart } from "@/components/charts/token-price-chart";
const kit = new AppKit();
const workingArcRpc = process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com";
const arcChainInKit = kit.getSupportedChains().find((c: any) => c.id === 5042002 || c.chain?.toLowerCase().includes("arc"));
if (arcChainInKit) {
  (arcChainInKit as any).rpcEndpoints = [
    workingArcRpc,
    "https://5042002.rpc.thirdweb.com"
  ];
  if ((arcChainInKit as any).rpcUrls) {
    (arcChainInKit as any).rpcUrls.default = { http: [workingArcRpc] };
    (arcChainInKit as any).rpcUrls.public = { http: [workingArcRpc] };
  }
}
const injTestnet = kit.getSupportedChains().find(c => c.chain === "Injective_Testnet");
if (injTestnet) {
  injTestnet.rpcEndpoints = [
    "https://k8s.testnet.json-rpc.injective.network/",
    "https://injectiveevm-testnet-rpc.polkachu.com"
  ];
}

type Asset = "USDC" | "EURC" | "cirBTC";
type Chain = "Arc Testnet" | "Arc Mainnet" | "Ethereum Sepolia" | "Arbitrum Sepolia" | "Arbitrum Mainnet" | "Base Sepolia" | "Base Mainnet" | "Ink Sepolia" | "Linea Sepolia" | "Monad Testnet" | "Sonic Testnet" | "Unichain Sepolia" | "Optimism Sepolia" | "Solana Devnet" | "Solana Mainnet" | "Injective EVM Testnet" | "Stellar Testnet" | "Avalanche Fuji" | "HyperEVM Testnet" | "Polygon Amoy Testnet" | "X Layer Testnet" | "Sui Testnet"
  | "Ethereum Mainnet" | "OP Mainnet" | "Polygon Mainnet" | "Avalanche Mainnet" | "Sonic Mainnet" | "Ink Mainnet" | "Unichain Mainnet" | "Linea Mainnet";

const TOKEN_ADDRESSES: Record<string, `0x${string}`> = {
  USDC: USDC_ADDRESS,
  EURC: EURC_ADDRESS,
};

const TOKEN_LOGOS: Record<string, string> = {
  USDC: "/usdc.png",
  EURC: "/eurc.png",
  cirBTC: "/cirbtc.png",
};

const CHAIN_LOGOS: Record<Chain, string> = {
  "Arc Testnet": "/arc-logo.png",
  "Arc Mainnet": "/arc-logo.png",
  "Ethereum Sepolia": "/icons/ethereum.svg",
  "Arbitrum Sepolia": "/icons/arbitrum.svg",
  "Arbitrum Mainnet": "/icons/arbitrum.svg",
  "Base Sepolia": "/icons/base.svg",
  "Base Mainnet": "/icons/base.svg",
  "Ethereum Mainnet": "/icons/ethereum.svg",
  "OP Mainnet": "/icons/optimism.svg",
  "Polygon Mainnet": "/icons/polygon.png",
  "Avalanche Mainnet": "/icons/avalanche.png",
  "Sonic Mainnet": "/icons/sonic.png",
  "Ink Mainnet": "/icons/ink.svg",
  "Unichain Mainnet": "/icons/unichain.svg",
  "Linea Mainnet": "/icons/linea.svg",
  "Ink Sepolia": "/icons/ink.svg",
  "Linea Sepolia": "/icons/linea.svg",
  "Monad Testnet": "/icons/monad.svg",
  "Sonic Testnet": "/icons/sonic.png",
  "Unichain Sepolia": "/icons/unichain.svg",
  "Optimism Sepolia": "/icons/optimism.svg",
  "Solana Devnet": "/icons/solana.png",
  "Solana Mainnet": "/icons/solana.png",
  "Injective EVM Testnet": "/icons/injective.png",
  "Stellar Testnet": "/icons/stellar.png",
  "Avalanche Fuji": "/icons/avalanche.png",
  "HyperEVM Testnet": "/icons/hyperevm.png",
  "Polygon Amoy Testnet": "/icons/polygon.png",
  "X Layer Testnet": "/icons/xlayer.png",
  "Sui Testnet": "/icons/sui.png",
};

// All USDC chains (L1s at top, followed by L2s)
const CHAINS: Chain[] = [
  "Arc Testnet", "Ethereum Sepolia", "Solana Devnet", "Sui Testnet",
  "Avalanche Fuji", "Monad Testnet", "Sonic Testnet", "HyperEVM Testnet",
  "Injective EVM Testnet", "Stellar Testnet",
  "Arbitrum Sepolia", "Base Sepolia", "Optimism Sepolia", "Ink Sepolia",
  "Linea Sepolia", "Unichain Sepolia", "X Layer Testnet", "Polygon Amoy Testnet"
];

// EURC is only deployed on these chains (Circle official + Arc Testnet)
const EURC_CHAINS: Chain[] = ["Arc Testnet", "Base Sepolia", "Ethereum Sepolia", "Avalanche Fuji"];

// cirBTC is only deployed on these chains (Circle CCTPx official)
const CIRBTC_CHAINS: Chain[] = ["Arc Testnet", "Ethereum Sepolia"];

// Official supported CCTP chains (L1s at top, followed by L2s)
const CCTP_CHAINS: Chain[] = [
  "Arc Testnet", "Ethereum Sepolia", "Solana Devnet", "Sui Testnet",
  "Avalanche Fuji", "Monad Testnet", "Sonic Testnet", "HyperEVM Testnet",
  "Injective EVM Testnet", "Stellar Testnet",
  "Arbitrum Sepolia", "Base Sepolia", "Optimism Sepolia", "Ink Sepolia",
  "Linea Sepolia", "Unichain Sepolia", "X Layer Testnet", "Polygon Amoy Testnet"
];

// L1 Chains that display the Fast badge (L1 chains only, no L2 rollups)
const L1_CHAINS: Set<Chain> = new Set([
  "Arc Testnet",
  "Ethereum Sepolia",
  "Solana Devnet",
  "Sui Testnet",
  "Avalanche Fuji",
  "Monad Testnet",
  "Sonic Testnet",
  "HyperEVM Testnet",
  "Injective EVM Testnet",
  "Stellar Testnet",
]);

const CHAIN_TOKEN_MATRIX: Record<Chain, Asset[]> = {
  "Arc Testnet": ["USDC", "EURC", "cirBTC"],
  "Arc Mainnet": ["USDC", "EURC"],
  "Ethereum Sepolia": ["USDC", "EURC", "cirBTC"],
  "Base Sepolia": ["USDC", "EURC"],
  "Base Mainnet": ["USDC"],
  "Arbitrum Mainnet": ["USDC"],
  "Ethereum Mainnet": ["USDC"],
  "OP Mainnet": ["USDC"],
  "Polygon Mainnet": ["USDC"],
  "Avalanche Mainnet": ["USDC"],
  "Sonic Mainnet": ["USDC"],
  "Ink Mainnet": ["USDC"],
  "Unichain Mainnet": ["USDC"],
  "Linea Mainnet": ["USDC"],
  "Arbitrum Sepolia": ["USDC"],
  "Unichain Sepolia": ["USDC"],
  "Monad Testnet": ["USDC"],
  "Sonic Testnet": ["USDC"],
  "Ink Sepolia": ["USDC"],
  "Linea Sepolia": ["USDC"],
  "Optimism Sepolia": ["USDC"],
  "Injective EVM Testnet": ["USDC"],
  "Solana Devnet": ["USDC"],
  "Solana Mainnet": ["USDC"],
  "Stellar Testnet": ["USDC"],
  "Avalanche Fuji": ["USDC", "EURC"],
  "HyperEVM Testnet": ["USDC"],
  "Polygon Amoy Testnet": ["USDC"],
  "X Layer Testnet": ["USDC"],
  "Sui Testnet": ["USDC"]
};

const CROSS_CHAIN_REGISTRY: Record<Chain, { rpc: string; USDC: `0x${string}`; EURC: `0x${string}`; cirBTC: `0x${string}` }> = {
  "Arc Testnet": { rpc: process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com", USDC: USDC_ADDRESS, EURC: EURC_ADDRESS, cirBTC: "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf" },
  "Arc Mainnet": { rpc: process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || "https://arc-mainnet.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8", USDC: "0x3600000000000000000000000000000000000000", EURC: "0x0", cirBTC: "0x0" },
  "Ethereum Sepolia": { rpc: process.env.NEXT_PUBLIC_ETH_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", USDC: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", EURC: "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4", cirBTC: "0x3a3fe695f684bf9b9e43cf43c2b895ea5e392bb3" },
  "Arbitrum Mainnet": { rpc: process.env.NEXT_PUBLIC_ARB_MAINNET_RPC_URL || "https://arb1.arbitrum.io/rpc", USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", EURC: "0x0", cirBTC: "0x0" },
  "Ethereum Mainnet": { rpc: process.env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com", USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", EURC: "0x0", cirBTC: "0x0" },
  "OP Mainnet": { rpc: process.env.NEXT_PUBLIC_OP_MAINNET_RPC_URL || "https://mainnet.optimism.io", USDC: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", EURC: "0x0", cirBTC: "0x0" },
  "Polygon Mainnet": { rpc: process.env.NEXT_PUBLIC_POLYGON_MAINNET_RPC_URL || "https://polygon-rpc.com", USDC: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", EURC: "0x0", cirBTC: "0x0" },
  "Avalanche Mainnet": { rpc: process.env.NEXT_PUBLIC_AVALANCHE_MAINNET_RPC_URL || "https://api.avax.network/ext/bc/C/rpc", USDC: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", EURC: "0x0", cirBTC: "0x0" },
  "Sonic Mainnet": { rpc: process.env.NEXT_PUBLIC_SONIC_MAINNET_RPC_URL || "https://rpc.soniclabs.com", USDC: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", EURC: "0x0", cirBTC: "0x0" },
  "Ink Mainnet": { rpc: process.env.NEXT_PUBLIC_INK_MAINNET_RPC_URL || "https://rpc-gel.inkonchain.com", USDC: "0x2D270e6886d130D724215A266106e6832161EAEd", EURC: "0x0", cirBTC: "0x0" },
  "Unichain Mainnet": { rpc: process.env.NEXT_PUBLIC_UNICHAIN_MAINNET_RPC_URL || "https://mainnet.unichain.org", USDC: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", EURC: "0x0", cirBTC: "0x0" },
  "Linea Mainnet": { rpc: process.env.NEXT_PUBLIC_LINEA_MAINNET_RPC_URL || "https://rpc.linea.build", USDC: "0x176211869ca2b568f2a7d4ee941e073a821ee1ff", EURC: "0x0", cirBTC: "0x0" },
  "Arbitrum Sepolia": { rpc: "https://sepolia-rollup.arbitrum.io/rpc", USDC: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", EURC: "0x0", cirBTC: "0x0" },
  "Base Sepolia": { rpc: "https://sepolia.base.org", USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", EURC: "0x808456652fdb597867f38412077A9182bf77359F", cirBTC: "0x0" },
  "Base Mainnet": { rpc: process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL || "https://mainnet.base.org", USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", EURC: "0x0", cirBTC: "0x0" },
  "Ink Sepolia": { rpc: process.env.NEXT_PUBLIC_INK_SEPOLIA_RPC_URL || process.env.INK_SEPOLIA_RPC_URL || "https://rpc-gel-sepolia.inkonchain.com", USDC: "0xFabab97dCE620294D2B0b0e46C68964e326300Ac", EURC: "0x0", cirBTC: "0x0" },
  "Linea Sepolia": { rpc: process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPC_URL || process.env.LINEA_SEPOLIA_RPC_URL || "https://rpc.sepolia.linea.build", USDC: "0xFEce4462D57bD51A6A552365A011b95f0E16d9B7", EURC: "0x0", cirBTC: "0x0" },
  "Monad Testnet": { rpc: process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL || process.env.MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz", USDC: "0x534b2f3A21130d7a60830c2Df862319e593943A3", EURC: "0x0", cirBTC: "0x0" },
  "Sonic Testnet": { rpc: "https://rpc.testnet.soniclabs.com", USDC: "0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51", EURC: "0x0", cirBTC: "0x0" },
  "Unichain Sepolia": { rpc: process.env.NEXT_PUBLIC_UNICHAIN_SEPOLIA_RPC_URL || process.env.UNICHAIN_SEPOLIA_RPC_URL || "https://sepolia.unichain.org", USDC: "0x31d0220469e10c4E71834a79b1f276d740d3768F", EURC: "0x0", cirBTC: "0x0" },
  "Optimism Sepolia": { rpc: "https://sepolia.optimism.io", USDC: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7", EURC: "0x0", cirBTC: "0x0" },
  "Injective EVM Testnet": { rpc: process.env.NEXT_PUBLIC_INJECTIVE_TESTNET_RPC_URL || "https://sentry.evm-rpc.injective.network", USDC: "0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d", EURC: "0x0", cirBTC: "0x0" },
  "Solana Devnet": { rpc: "", USDC: "0x0", EURC: "0x0", cirBTC: "0x0" },
  "Solana Mainnet": { rpc: "", USDC: "0x0", EURC: "0x0", cirBTC: "0x0" },
  "Stellar Testnet": { rpc: process.env.NEXT_PUBLIC_STELLAR_RPC_URL || "https://stellar-testnet.g.alchemy.com/v2/Vt9_fvDipTI7hEZdMc950", USDC: "0x0", EURC: "0x0", cirBTC: "0x0" },
  "Avalanche Fuji": { rpc: process.env.NEXT_PUBLIC_AVALANCHE_FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc", USDC: "0x5425890298aed601595a70ab815c96711a31bc65", EURC: "0x5E44db7996c682E92a960b65AC713a54AD815c6B", cirBTC: "0x0" },
  "HyperEVM Testnet": { rpc: process.env.NEXT_PUBLIC_HYPEREVM_TESTNET_RPC_URL || "https://rpc.hyperliquid-testnet.xyz/evm", USDC: "0x2B3370eE501B4a559b57D449569354196457D8Ab", EURC: "0x0", cirBTC: "0x0" },
  "Polygon Amoy Testnet": { rpc: process.env.NEXT_PUBLIC_POLYGON_AMOY_RPC_URL || "https://rpc-amoy.polygon.technology", USDC: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582", EURC: "0x0", cirBTC: "0x0" },
  "X Layer Testnet": { rpc: process.env.NEXT_PUBLIC_XLAYER_TESTNET_RPC_URL || "https://testrpc.xlayer.tech", USDC: "0xDec90b78111Ba2fc6FC6d84d8B9ec159A2d4b9B3", EURC: "0x0", cirBTC: "0x0" },
  "Sui Testnet": { rpc: process.env.NEXT_PUBLIC_SUI_RPC_URL || "https://fullnode.testnet.sui.io:443", USDC: "0x0", EURC: "0x0", cirBTC: "0x0" }
};

const formatAssetBalance = (val: string, asset?: string) => {
  if (!val || val === "0") return "0";
  const parts = val.split(".");
  if (parts.length === 1) return parts[0];
  const maxDecimals = asset === "cirBTC" ? 8 : 6;
  const decimals = parts[1].slice(0, maxDecimals).replace(/0+$/, "");
  return decimals.length > 0 ? `${parts[0]}.${decimals}` : parts[0];
};

const limitsPromiseCache = new Map<string, { promise: Promise<any>, timestamp: number }>();
const CACHE_TTL = 10000; // 10 seconds

function fetchWalletLimitsDeduped(token: string) {
  const now = Date.now();
  const cached = limitsPromiseCache.get(token);

  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    return cached.promise;
  }

  const promise = fetch("/api/wallet/limits", {
    headers: { 'Authorization': `Bearer ${token}` },
    cache: 'no-store'
  }).then(res => {
    if (!res.ok) throw new Error("Limits fetch failed");
    return res.json();
  }).catch(err => {
    limitsPromiseCache.delete(token); // Clear cache on error so next attempt tries again
    throw err;
  });

  limitsPromiseCache.set(token, { promise, timestamp: now });
  return promise;
}

// Admin wallets - access granted on ALL chains, not just Arc Testnet
const ADMIN_WALLETS = [
  "0xe2ED006Dbb1726e0f577733F65d30a94D34bDD77",
  "0xd448777940dFaBF65FD259fA8a9903e60E1FF178",
  "0x4a6b6887e6f0dd99ea9cc1a36a6bc02c14c80d5a",
  "0xdd1c0bdefce4e5ca334753b58cf7009d97473df0",
].map(a => a.toLowerCase());
const ROBINHOOD_TOKENS = [
  {
    chainId: 4663,
    address: '0x0000000000000000000000000000000000000000',
    symbol: 'ETH',
    name: 'Ethereum',
    decimals: 18,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
  },
  {
    chainId: 4663,
    address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
    symbol: 'WETH',
    name: 'Wrapped ETH',
    decimals: 18,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png',
  },
  {
    chainId: 4663,
    address: '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34',
    symbol: 'USDe',
    name: 'Ethena USDe',
    decimals: 18,
    logoURI: 'https://static.debank.com/image/eth_token/logo_url/0x4c9edd5852cd905f086c759e8383e09bff1e68b3/734064e545eabfc501b9d0e752644b7d.png',
  },
  {
    chainId: 4663,
    address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
    symbol: 'USDG',
    name: 'USDG',
    decimals: 6,
    logoURI: 'https://s2.coinmarketcap.com/static/img/coins/64x64/33793.png',
  },
  {
    chainId: 4663,
    address: '0xC72c01AAB5f5678dc1d6f5C6d2B417d91D402Ba3',
    symbol: 'HOODIE',
    name: 'HOODIE',
    decimals: 18,
    logoURI: 'https://cdn.dexscreener.com/cms/images/lPw_YhoFA-ThjIWZ?width=128&height=128&quality=95&format=auto',
  }
];

const ARC_MAINNET_TOKENS = [
  {
    chainId: 5042,
    address: '0x3600000000000000000000000000000000000000',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
    logoURI: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png',
  }
];

function ConnectWalletButton({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-[calc(100%-24px)] mx-auto block mt-2 mb-2 h-[48px] md:h-[56px] rounded-full font-semibold text-[14px] md:text-[16px] transition-all duration-200 focus:outline-none active:scale-95 hover:opacity-90 bg-gray-600 dark:bg-gray-200 text-white dark:text-gray-900 border border-gray-500 dark:border-gray-300"
      style={{
        cursor: "pointer",
        letterSpacing: "0.01em"
      }}
    >
      {text}
    </button>
  );
}

// Client-side cache for dynamic gas eligibility checks (30s TTL)
const gasEligibilityClientCache = new Map<string, { elig: any; timestamp: number }>();

export function SwapBridgeManager({
  onOpenFaucetHub,
  sidebarCollapsed = false,
}: {
  onOpenFaucetHub?: () => void;
  sidebarCollapsed?: boolean;
}) {
  const { address } = useAccount();
  const suiWallet = useSuiWallet();
  const { mode } = useEnvironment();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";
  const publicClient = usePublicClient();
  const robinhoodClient = usePublicClient({ chainId: 4663 });
  const arcMainnetClient = usePublicClient({ chainId: 5042 });
  const walletChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useConfig();

  const [activeTab, setActiveTab] = useState<"bridge" | "recover" | "admin" | "history">("bridge");
  const [isBridgeSubmitting, setIsBridgeSubmitting] = useState(false);
  const [bridgeFromAsset, setBridgeFromAsset] = useState<Asset | null>("USDC");
  const [bridgeToAsset, setBridgeToAsset] = useState<Asset | null>("USDC");
  const [bridgeFromChain, setBridgeFromChain] = useState<Chain | null>(null);
  const [bridgeToChain, setBridgeToChain] = useState<Chain | null>(null);
  const [bridgeAmount, setBridgeAmount] = useState("");
  const [showFromChainPicker, setShowFromChainPicker] = useState(false);
  const [showToChainPicker, setShowToChainPicker] = useState(false);
  const [showBridgeTokenDropdown, setShowBridgeTokenDropdown] = useState(false);
  const [showBridgeToTokenDropdown, setShowBridgeToTokenDropdown] = useState(false);

  // Dynamic Gas Eligibility State (CCTP)
  const [gasEligibility, setGasEligibility] = useState<{
    isSponsoredEligible: boolean;
    isManualClaimRequired: boolean;
    manualClaimReason?: string;
    totalEstimatedClaimFeeUsd?: number;
    relayerBalanceUsd?: number;
    configuredMinRelayerBalanceUsd?: number;
    configuredMaxSponsoredFeeUsd?: number;
  } | null>(null);
  const [isGasEligibilityLoading, setIsGasEligibilityLoading] = useState(false);
  const [isManualClaimSelfMint, setIsManualClaimSelfMint] = useState(false);

  // Fetch dynamic gas eligibility when bridge destination chain changes
  useEffect(() => {
    if (!bridgeToChain) {
      setGasEligibility(null);
      setIsManualClaimSelfMint(false);
      setIsGasEligibilityLoading(false);
      return;
    }

    const cacheKey = `${bridgeToChain}_${mode}`;
    const cached = gasEligibilityClientCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.timestamp < 30_000) {
      setGasEligibility(cached.elig);
      if (cached.elig.isManualClaimRequired) {
        setIsManualClaimSelfMint(true);
      }
      setIsGasEligibilityLoading(false);
      return;
    }

    let isMounted = true;
    setIsGasEligibilityLoading(true);

    const isMainnet = mode === "mainnet";
    const url = `/api/bridge/gas-eligibility?destinationChain=${encodeURIComponent(bridgeToChain)}&isMainnet=${isMainnet}`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (!isMounted) return;
        if (data.success && data.eligibility) {
          const elig = data.eligibility;
          gasEligibilityClientCache.set(cacheKey, { elig, timestamp: Date.now() });
          setGasEligibility(elig);
          if (elig.isManualClaimRequired) {
            setIsManualClaimSelfMint(true);
          }
        }
      })
      .catch((err) => {
        console.warn("[Bridge] Gas eligibility check failed:", err);
      })
      .finally(() => {
        if (isMounted) setIsGasEligibilityLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [bridgeToChain, mode]);

  const isFromTokenDropdownAvailable =
    bridgeFromChain ? ((CHAIN_TOKEN_MATRIX[bridgeFromChain] || []).length > 1) : false;
  const isToTokenDropdownAvailable =
    bridgeToChain ? ((CHAIN_TOKEN_MATRIX[bridgeToChain] || []).length > 1) : false;

  const isEurcSupportedRoute =
    !!bridgeFromChain &&
    !!bridgeToChain &&
    bridgeFromChain !== bridgeToChain &&
    EURC_CHAINS.includes(bridgeFromChain) &&
    EURC_CHAINS.includes(bridgeToChain);

  const handleSelectFromToken = useCallback((asset: Asset) => {
    setBridgeFromAsset(asset);
    setBridgeToAsset(asset);
    setShowBridgeTokenDropdown(false);
  }, []);

  const handleSelectToToken = useCallback((asset: Asset) => {
    setBridgeFromAsset(asset);
    setBridgeToAsset(asset);
    setShowBridgeToTokenDropdown(false);
  }, []);

  const [executionMode, setExecutionMode] = useState<"browser" | "arcfun">("browser");
  const [showExecutionSelector, setShowExecutionSelector] = useState(false);

  useEffect(() => {
    if ((activeTab === "bridge" || mode === "mainnet") && executionMode === "arcfun") {
      setExecutionMode("browser");
    }
  }, [activeTab, executionMode, mode]);

  useEffect(() => {
    // If activeTab is stuck on an invalid value (like "swap" from hot reload memory), force it to "bridge"
    if (activeTab !== "bridge" && activeTab !== "recover" && activeTab !== "admin" && activeTab !== "history") {
      setActiveTab("bridge");
    }
  }, [activeTab]);
  const [isAwaitingTx, setIsAwaitingTx] = useState(false);
  const [walletLimits, setWalletLimits] = useState<{
    dailyLimit: number;
    maxPerTransaction: number;
    completedSpentToday: number;
    pendingReservedToday: number;
    remainingAvailableToday: number;
  } | null>(null);
  const [isLimitsLoading, setIsLimitsLoading] = useState(false);
  const [arcWalletAddress, setArcWalletAddress] = useState<string | null>(null);
  const [hasCheckedArcWallet, setHasCheckedArcWallet] = useState(false);

  const fetchWalletLimits = useCallback(() => {
    if (executionMode === "arcfun" && arcWalletAddress) {
      setIsLimitsLoading(true);
      import("@/lib/supabase").then(({ supabase }) => {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) {
            setIsLimitsLoading(false);
            return;
          }
          fetchWalletLimitsDeduped(session.access_token)
            .then(data => {
              if (data && data.dailyLimit !== undefined) setWalletLimits(data);
            })
            .catch(console.error)
            .finally(() => setIsLimitsLoading(false));
        });
      });
    } else if (executionMode !== "arcfun") {
      setWalletLimits(null);
    }
  }, [executionMode, arcWalletAddress]);

  useEffect(() => {
    fetchWalletLimits();
  }, [fetchWalletLimits, isAwaitingTx]);

  const txEngine = useTxEngine();
  const txTrackerRef = useRef<TxTrackerRef>(null);



  const handleInputFocus = () => {
    if (txEngine.state === "success" || txEngine.state === "failed") {
      txEngine.dismiss();
      txTrackerRef.current?.dismiss();
    }
  };

  // Only hide bottom navigation options when an actual amount is entered on Bridge tab
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (activeTab === "bridge") {
      const num = Number(bridgeAmount);
      if (bridgeAmount && !isNaN(num) && num > 0) {
        window.dispatchEvent(new CustomEvent("arc-hide-bottom-nav"));
      } else {
        window.dispatchEvent(new CustomEvent("arc-show-bottom-nav"));
      }
    } else {
      window.dispatchEvent(new CustomEvent("arc-show-bottom-nav"));
    }
    return () => {
      window.dispatchEvent(new CustomEvent("arc-show-bottom-nav"));
    };
  }, [bridgeAmount, activeTab]);




  const [transferId, setTransferId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ title: string, message: string, type: "success" | "error" } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [historyFilter, setHistoryFilter] = useState<"all" | "success" | "pending" | "failed">("all");
  // Cursor-stack for server-side pagination:
  //   cursorStack[0] = null (page 1 always starts with no cursor)
  //   cursorStack[1] = nextCursor returned after page 1 (used to fetch page 2)
  //   cursorStack[N] = nextCursor for page N+1
  const [cursorStack, setCursorStack] = useState<(string | null)[]>([null]);
  const currentCursor = cursorStack[cursorStack.length - 1]; // cursor for the currently-visible page
  const currentPageNumber = cursorStack.length; // 1-indexed
  const [expandedHistoryIds, setExpandedHistoryIds] = useState<Set<string>>(new Set());
  const [historyUpdateMsg, setHistoryUpdateMsg] = useState<string | null>(null);
  const prevHistoryRef = useRef<string>("");
  const isManualRefreshRef = useRef<boolean>(false);

  const toggleHistoryExpand = (id: string) => {
    setExpandedHistoryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };


  // ── Access Control State ────────────────────────────────────────────────────
  const isAdmin = !!address && ADMIN_WALLETS.includes(address.toLowerCase());
  const hasAccess = true;
  const hasBridgeAccess = true;

  const { history: historyItems, isLoading: isHistoryLoading, refetchHistory, hasMore: historyHasMore, nextCursor: historyNextCursor } = useOnChainHistory({
    hasAccess: true,
    enabled: activeTab === "history",
    cursor: currentCursor,
    statusFilter: historyFilter,
  });

  // ── Bridge Route Control (EVM / Solana <-> Sui) ─────────────────────────────
  const [routeSettings, setRouteSettings] = useState<{
    evmToSui: boolean;
    suiToEvm: boolean;
    solanaToSui: boolean;
    suiToSolana: boolean;
  }>({
    evmToSui: true,
    suiToEvm: true,
    solanaToSui: true,
    suiToSolana: true,
  });

  const lastRouteFetchRef = useRef<number>(0);
  const fetchRouteSettings = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastRouteFetchRef.current < 30_000) return;
    lastRouteFetchRef.current = now;

    try {
      const { data } = await supabase
        .from("onchain_access_settings")
        .select("*")
        .in("module", ["bridge_evm_to_sui", "bridge_sui_to_evm", "bridge_solana_to_sui", "bridge_sui_to_solana"]);

      if (data) {
        let evmToSui = true;
        let suiToEvm = true;
        let solanaToSui = true;
        let suiToSolana = true;
        data.forEach((row: any) => {
          if (row.module === "bridge_evm_to_sui" && row.mode === "paused") evmToSui = false;
          if (row.module === "bridge_sui_to_evm" && row.mode === "paused") suiToEvm = false;
          if (row.module === "bridge_solana_to_sui" && row.mode === "paused") solanaToSui = false;
          if (row.module === "bridge_sui_to_solana" && row.mode === "paused") suiToSolana = false;
        });
        setRouteSettings((prev) => {
          if (
            prev.evmToSui === evmToSui &&
            prev.suiToEvm === suiToEvm &&
            prev.solanaToSui === solanaToSui &&
            prev.suiToSolana === suiToSolana
          ) {
            return prev;
          }
          return { evmToSui, suiToEvm, solanaToSui, suiToSolana };
        });
      }
    } catch (e) {
      console.error("Error fetching route settings:", e);
    }
  }, []);

  useEffect(() => {
    fetchRouteSettings(true);
    const onFocus = () => fetchRouteSettings();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchRouteSettings]);

  const isEvmToSuiRoute = !!bridgeFromChain && !!bridgeToChain && !bridgeFromChain.includes("Solana") && bridgeFromChain !== "Sui Testnet" && bridgeToChain === "Sui Testnet";
  const isSuiToEvmRoute = !!bridgeFromChain && !!bridgeToChain && bridgeFromChain === "Sui Testnet" && !bridgeToChain.includes("Solana") && bridgeToChain !== "Sui Testnet";
  const isSolanaToSuiRoute = !!bridgeFromChain && !!bridgeToChain && bridgeFromChain.includes("Solana") && bridgeToChain === "Sui Testnet";
  const isSuiToSolanaRoute = !!bridgeFromChain && !!bridgeToChain && bridgeFromChain === "Sui Testnet" && bridgeToChain.includes("Solana");

  const isCurrentRoutePaused =
    (isEvmToSuiRoute && routeSettings.evmToSui === false) ||
    (isSuiToEvmRoute && routeSettings.suiToEvm === false) ||
    (isSolanaToSuiRoute && routeSettings.solanaToSui === false) ||
    (isSuiToSolanaRoute && routeSettings.suiToSolana === false);

  const isRouteBlocked = isCurrentRoutePaused && !isAdmin;

  // Cross-chain bridge balance state
  const [crossChainBal, setCrossChainBal] = useState<bigint>(0n);
  const [crossChainToBal, setCrossChainToBal] = useState<bigint>(0n);
  const [crossChainToDecimals, setCrossChainToDecimals] = useState<number>(6);
  const [isCrossChainLoading, setIsCrossChainLoading] = useState(false);
  const [isRotated, setIsRotated] = useState(false);
  const [bridgeEstimate, setBridgeEstimate] = useState<any>(null);
  const [isFeeRefreshing, setIsFeeRefreshing] = useState(false);
  const [feeRefreshCounter, setFeeRefreshCounter] = useState(0);
  const [hasPendingBridge, setHasPendingBridge] = useState(false);

  const handleHistoryRefresh = async () => {
    if (isHistoryLoading || isRefreshing) return;
    setIsRefreshing(true);
    setHistoryUpdateMsg(null);
    prevHistoryRef.current = JSON.stringify(historyItems);
    isManualRefreshRef.current = true;
    await refetchHistory(true);
    setLastUpdated(new Date());
    setIsRefreshing(false);
  };

  useEffect(() => {
    if (isManualRefreshRef.current && !isRefreshing) {
      isManualRefreshRef.current = false;
      const currentStr = JSON.stringify(historyItems);
      if (currentStr !== prevHistoryRef.current) {
        setHistoryUpdateMsg("History updated");
      } else {
        setHistoryUpdateMsg("Already up to date");
      }
      setTimeout(() => setHistoryUpdateMsg(null), 2500);
    }
  }, [historyItems, isRefreshing]);

  useEffect(() => {
    if (typeof window === "undefined" || !address) {
      setHasPendingBridge(false);
      return;
    }
    const checkPendingStatus = () => {
      const userAddr = address.toLowerCase();
      // Fast synchronous check against local store (0 RPC / 0 API overhead)
      const localPending = getTxHistory(mode).some(
        tx => tx.userAddress?.toLowerCase() === userAddr && tx.status === "pending"
      );
      if (localPending) {
        setHasPendingBridge(true);
        return;
      }
      const pendingItems = historyItems.some(
        tx => tx.userAddress?.toLowerCase() === userAddr && tx.status === "pending"
      );
      setHasPendingBridge(pendingItems);
    };

    checkPendingStatus();

    const handleStorageOrHistoryUpdate = () => checkPendingStatus();
    window.addEventListener("arc-history-updated", handleStorageOrHistoryUpdate);
    return () => {
      window.removeEventListener("arc-history-updated", handleStorageOrHistoryUpdate);
    };
  }, [address, historyItems, mode]);
  const { data: walletClient } = useWalletClient();
  const solanaWallet = useWallet();
  const solanaConnected = solanaWallet.connected;
  const stellarWallet = useStellar();


  const tokenInAddr = (bridgeFromAsset ? TOKEN_ADDRESSES[bridgeFromAsset] : undefined) as `0x${string}`;



  useEffect(() => {
    if (executionMode === "arcfun" && !arcWalletAddress) {
      import("@/lib/supabase").then(({ supabase }) => {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (!session) {
            setHasCheckedArcWallet(true);
            return;
          }
          fetch("/api/wallet/health", {
            headers: { 'Authorization': `Bearer ${session.access_token}` }
          })
            .then(res => res.json())
            .then(data => {
              if (data.wallet) setArcWalletAddress(data.wallet);
            })
            .catch(console.error)
            .finally(() => setHasCheckedArcWallet(true));
        });
      });
    }

    const handleArcWalletConnected = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail && customEvent.detail.address) {
        setArcWalletAddress(customEvent.detail.address);
        setHasCheckedArcWallet(true);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener('arc-wallet-connected', handleArcWalletConnected);
    }

    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener('arc-wallet-connected', handleArcWalletConnected);
      }
    };
  }, [executionMode, arcWalletAddress]);

  const effectiveAddress = executionMode === "arcfun" ? (arcWalletAddress as `0x${string}` | undefined) : address;

  // ── Arc Testnet USDC ERC20 Balance ──
  // The contract uses the ERC20 USDC (6 decimals), NOT the native gas token (18 decimals).
  const { data: nativeBalData, isLoading: isLoadingNative, refetch: refetchNative } = useBalance({
    address: effectiveAddress,
    token: USDC_ADDRESS,
    chainId: CHAIN_ID_MAP["Arc Testnet"],
    query: { enabled: mode === "testnet" && !!effectiveAddress && bridgeFromAsset === "USDC" && (hasAccess || hasBridgeAccess) },
  });

  // ── Arc Testnet EURC Balance ──
  const { data: eurcBalRaw = 0n, isLoading: isLoadingEurc, refetch: refetchEurc } = useReadContract({
    address: EURC_ADDRESS as `0x${string}`,
    abi: ERC20_APPROVE_ABI,
    functionName: "balanceOf",
    args: effectiveAddress ? [effectiveAddress] : undefined,
    chainId: CHAIN_ID_MAP["Arc Testnet"],
    query: { enabled: mode === "testnet" && !!effectiveAddress && bridgeFromAsset === "EURC" && (hasAccess || hasBridgeAccess) },
  });

  const { data: eurcDecimals = 6 } = useReadContract({
    address: EURC_ADDRESS as `0x${string}`,
    abi: ERC20_APPROVE_ABI,
    functionName: "decimals",
    chainId: CHAIN_ID_MAP["Arc Testnet"],
    query: { enabled: mode === "testnet" && (hasAccess || hasBridgeAccess) && (bridgeFromAsset === "EURC" || bridgeToAsset === "EURC") },
  });

  // Bridge allowance — checks against the correct spender based on selected route
  // CCTP: TokenMessengerV2 on src chain for USDC, or CCTS TokenManager for EURC
  const cctpDomains = getCctpDomains(mode);
  const bridgeSourceDomain = bridgeFromChain ? (cctpDomains[bridgeFromChain] || resolveCctpDomain(bridgeFromChain, mode)) : undefined;
  const isEurcBridge = bridgeFromAsset === "EURC";
  const isCirBtcBridge = bridgeFromAsset === "cirBTC";
  const bridgeSpender: `0x${string}` = isCirBtcBridge
    ? ("0xb995f4060c38b7608626d0ccabe547cdc2c7390a" as `0x${string}`)
    : isEurcBridge
    ? (CCTS_TOKEN_MANAGER_ADDRESS as `0x${string}`)
    : ((bridgeSourceDomain?.tokenMessenger as `0x${string}` | undefined) ?? (mode === "mainnet" ? "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" : "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa"));
  const bridgeTokenAddress: `0x${string}` = isCirBtcBridge
    ? (((CROSS_CHAIN_REGISTRY as any)[bridgeFromChain || ""]?.cirBTC) || "0x0" as `0x${string}`)
    : isEurcBridge
    ? (((bridgeSourceDomain as any)?.eurc || ((CROSS_CHAIN_REGISTRY as any)[bridgeFromChain || ""]?.EURC) || EURC_ADDRESS) as `0x${string}`)
    : ((bridgeSourceDomain?.usdc as `0x${string}` | undefined) ?? tokenInAddr);
  const bridgeSourceChainId = bridgeFromChain ? CHAIN_ID_MAP[bridgeFromChain] : undefined;

  const { data: bridgeAllowance = 0n } = useReadContract({
    address: bridgeTokenAddress,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: effectiveAddress ? [effectiveAddress, bridgeSpender] : undefined,
    chainId: bridgeSourceChainId,
    query: { enabled: !!effectiveAddress && activeTab === "bridge" && Number(bridgeAmount) > 0 && !!bridgeSourceChainId && bridgeTokenAddress !== "0x0" },
  });

  // ── Cross Chain Balance Fetcher (For Bridge Tab) ──
  const [crossChainDecimals, setCrossChainDecimals] = useState<number>(6);

  const [viemAdapter, setViemAdapter] = useState<any>(null);

  useEffect(() => {
    let active = true;
    if (walletClient) {
      const provider = (walletClient as any).transport;
      createViemAdapterFromProvider({
        provider,
        // @ts-ignore - Viem v1/v2 PublicClient mismatch with adapter
        getPublicClient: ({ chain }: any) => {
          let transport;
          if (chain.id === 5042002) {
            transport = fallback([
              http(process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com", { retryCount: 2, retryDelay: 500, batch: true }),
              http("https://5042002.rpc.thirdweb.com", { retryCount: 2, retryDelay: 500, batch: true })
            ]);
          } else {
            const rpcUrl = chain.rpcEndpoints?.[0] || chain.rpcUrls?.default?.http[0];
            transport = http(rpcUrl, { retryCount: 3, retryDelay: 1000, batch: true });
          }

          const effectiveChain = chain.id === 5042002 ? {
            ...chain,
            rpcUrls: {
              default: { http: [process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com"] },
              public: { http: [process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com"] }
            },
            rpcEndpoints: [process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com"]
          } : chain;

          return createPublicClient({
            chain: effectiveChain,
            transport,
            pollingInterval: 5000
          });
        },
        capabilities: {
          supportedChains: kit.getSupportedChains().filter((c: any) => c.type === 'evm') as any
        }
      }).then(adapter => {
        if (active) setViemAdapter(adapter);
      }).catch(console.error);
    } else {
      setViemAdapter(null);
    }
    return () => { active = false; };
  }, [walletClient]);

  // Auto-refresh bridge fees every 10 seconds ONLY when bridge tab is active and an amount is entered
  useEffect(() => {
    if (activeTab === "bridge" && Number(bridgeAmount) > 0) {
      const interval = setInterval(() => {
        setIsFeeRefreshing(true);
        setFeeRefreshCounter(c => c + 1);
      }, 10000);
      return () => clearInterval(interval);
    } else {
      setIsFeeRefreshing(false);
    }
  }, [activeTab, bridgeAmount]);

  useEffect(() => {
    let isSubscribed = true;
    if (activeTab === "bridge" && bridgeFromChain && bridgeToChain && bridgeFromAsset && bridgeToAsset && Number(bridgeAmount) > 0 && viemAdapter) {
      const timer = setTimeout(async () => {
        try {
          const formatChain = (chainName: string) => {
            if (chainName === "Base Mainnet") return "Base";
            if (chainName === "Arbitrum Mainnet") return "Arbitrum";
            if (chainName === "Ethereum Mainnet") return "Ethereum";
            if (chainName === "OP Mainnet") return "Optimism";
            if (chainName === "Polygon Mainnet") return "Polygon";
            if (chainName === "Avalanche Mainnet") return "Avalanche";
            if (chainName === "Sonic Mainnet") return "Sonic";
            if (chainName === "Ink Mainnet") return "Ink";
            if (chainName === "Unichain Mainnet") return "Unichain";
            if (chainName === "Linea Mainnet") return "Linea";
            if (chainName === "Ink Sepolia") return "Ink_Testnet";
            if (chainName === "Injective EVM Testnet") return "Injective_Testnet";
            return chainName.replaceAll(" ", "_");
          };

          if (
            bridgeToChain?.includes("Solana") || bridgeFromChain?.includes("Solana") ||
            bridgeToChain?.includes("Sui") || bridgeFromChain?.includes("Sui")
          ) {
            if (isSubscribed) {
              setBridgeEstimate({ gasFees: [] });
              setIsFeeRefreshing(false);
            }
            return;
          }

          // Live on-chain gas estimation for Arc Mainnet / Base Mainnet / EVM routes
          if (mode === "mainnet" || bridgeFromChain === "Arc Mainnet" || bridgeToChain === "Arc Mainnet" || bridgeFromChain.includes("Mainnet")) {
            try {
              const { ChainRegistry } = await import("@/lib/bridge/chain-registry");
              const srcConfig = ChainRegistry.getChainSafe(bridgeFromChain);
              if (srcConfig?.rpcUrl) {
                const { createPublicClient, http, formatUnits } = await import("viem");
                const srcClient = createPublicClient({ transport: http(srcConfig.rpcUrl, { timeout: 4000 }) });
                const gasPrice = await srcClient.getGasPrice().catch(() => 100000000n);
                const estimatedUnits = bridgeFromChain === "Arc Mainnet" ? 150000n : 210000n;
                const totalWei = estimatedUnits * gasPrice;
                const nativeSymbol = srcConfig.nativeCurrency?.symbol || (bridgeFromChain === "Arc Mainnet" ? "USDC" : "ETH");
                const nativeDecimals = srcConfig.nativeCurrency?.decimals || 18;
                const feeInNative = Number(formatUnits(totalWei, nativeDecimals));

                if (isSubscribed) {
                  setBridgeEstimate({
                    gasFees: [
                      {
                        name: bridgeFromChain.replace(" Mainnet", ""),
                        fee: feeInNative > 0 ? (feeInNative < 0.00001 ? 0.00001 : feeInNative) : 0.0001,
                        token: nativeSymbol
                      },
                      {
                        name: "Destination Claim",
                        fee: 0,
                        token: "Sponsored ($0.00)"
                      }
                    ]
                  });
                  setIsFeeRefreshing(false);
                }
                return;
              }
            } catch (mainnetGasErr) {
              console.warn("[Bridge Mainnet Gas Estimation]", mainnetGasErr);
            }
          }

          const est = await kit.estimateBridge({
            from: { adapter: viemAdapter, chain: formatChain(bridgeFromChain) as any },
            to: { adapter: viemAdapter, chain: formatChain(bridgeToChain) as any },
            amount: bridgeAmount
          });
          if (isSubscribed) {
            setBridgeEstimate(est);
            setIsFeeRefreshing(false);
          }
        } catch (e) {
          console.warn("[BridgeKit Estimation]", e);
          if (isSubscribed) {
            setBridgeEstimate({ gasFees: [] });
            setIsFeeRefreshing(false);
          }
        }
      }, feeRefreshCounter > 0 ? 0 : 800);
      return () => {
        isSubscribed = false;
        clearTimeout(timer);
      };
    } else {
      setBridgeEstimate(null);
      setIsFeeRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, bridgeAmount, bridgeFromChain, bridgeToChain, feeRefreshCounter]);



  const suiAddress = suiWallet.address;
  const suiIsConnected = suiWallet.isConnected;
  const stellarAddress = stellarWallet.address;
  const stellarIsConnected = stellarWallet.isConnected;
  const stellarUsdcBal = stellarWallet.usdcBalance;
  const solanaPubkeyStr = solanaWallet.publicKey?.toBase58();

  const fetchSingleChainBalance = useCallback(async (chainName: string | undefined, assetName: string | undefined): Promise<{ balance: bigint; decimals: number }> => {
    if (!chainName || !assetName) return { balance: 0n, decimals: 6 };

    const userAddr = (effectiveAddress || address) as `0x${string}`;

    if (chainName === "Arc Testnet") {
      if (!userAddr) return { balance: 0n, decimals: assetName === "cirBTC" ? 8 : 6 };
      try {
        const primaryRpc = process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com";
        const assetAddr = assetName === "cirBTC"
          ? (CROSS_CHAIN_REGISTRY["Arc Testnet"]?.cirBTC || "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf")
          : assetName === "EURC"
          ? EURC_ADDRESS
          : USDC_ADDRESS;
        const defaultDecimals = assetName === "cirBTC" ? 8 : 6;
        let res = { balance: 0n, decimals: defaultDecimals };
        await withEvmFailover(chainName, primaryRpc, async (rpcUrl) => {
          const pc = createPublicClient({ transport: http(rpcUrl) });
          const [b, d] = await Promise.all([
            pc.readContract({
              address: assetAddr as `0x${string}`,
              abi: ERC20_APPROVE_ABI,
              functionName: "balanceOf",
              args: [userAddr]
            }),
            pc.readContract({
              address: assetAddr as `0x${string}`,
              abi: ERC20_APPROVE_ABI,
              functionName: "decimals"
            }).catch(() => defaultDecimals)
          ]);
          res = { balance: b as bigint, decimals: Number(d) || defaultDecimals };
        }, "fetchSingleChainBalance");
        return res;
      } catch (err) {
        console.error("Failed to fetch Arc Testnet balance:", err);
        return { balance: 0n, decimals: assetName === "cirBTC" ? 8 : 6 };
      }
    }

    if (chainName === "Arc Mainnet") {
      if (!userAddr) return { balance: 0n, decimals: 6 };
      try {
        const primaryRpc = process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || "https://arc-mainnet.infura.io/v3/b6bf7d3508c941499b10025c0776eaf8";
        let res = { balance: 0n, decimals: 6 };
        await withEvmFailover(chainName, primaryRpc, async (rpcUrl) => {
          const pc = createPublicClient({ transport: http(rpcUrl) });
          const b = await pc.readContract({
            address: "0x3600000000000000000000000000000000000000" as `0x${string}`,
            abi: ERC20_APPROVE_ABI,
            functionName: "balanceOf",
            args: [userAddr]
          });
          res = { balance: b as bigint, decimals: 6 };
        }, "fetchSingleChainBalance");
        return res;
      } catch {
        return { balance: 0n, decimals: 6 };
      }
    }

    if (chainName.includes("Solana")) {
      if (!solanaConnected || !solanaPubkeyStr) return { balance: 0n, decimals: 6 };
      try {
        const { Connection, PublicKey } = await import("@solana/web3.js");
        const mintAddress = chainName === "Solana Devnet"
          ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
          : "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

        let res = { balance: 0n, decimals: 6 };
        const isMainnetSol = isMainnetChain(chainName);
        await withSolanaFailover(async (rpcUrl) => {
          const connection = new Connection(rpcUrl);
          const accounts = await connection.getParsedTokenAccountsByOwner(
            new PublicKey(solanaPubkeyStr),
            { mint: new PublicKey(mintAddress) }
          );

          if (accounts.value.length > 0) {
            const balanceInfo = accounts.value[0].account.data.parsed.info.tokenAmount;
            res = { balance: BigInt(balanceInfo.amount), decimals: balanceInfo.decimals || 6 };
          }
        }, "fetchSingleChainBalance", isMainnetSol);
        return res;
      } catch (e) {
        console.error("Failed to fetch Solana balance", e);
        return { balance: 0n, decimals: 6 };
      }
    }

    if (chainName === "Stellar Testnet") {
      const activeStellarAddr = stellarAddress || (stellarWallet?.address ?? null) || (typeof window !== "undefined" ? localStorage.getItem("arc_stellar_address") : null);
      if (!activeStellarAddr) return { balance: 0n, decimals: 7 };
      try {
        const live = await fetchLiveStellarUsdcBalance(activeStellarAddr);
        if (stellarWallet?.refreshBalances) {
          stellarWallet.refreshBalances(activeStellarAddr).catch(() => {});
        }
        return { balance: live.balance, decimals: live.decimals };
      } catch (e) {
        console.warn("Direct live Stellar fetch failed, falling back to cached balance:", e);
        const balStr = assetName === "USDC" ? stellarUsdcBal : "0";
        const balBigInt = BigInt(Math.round(parseFloat(balStr || "0") * 1e7));
        return { balance: balBigInt, decimals: 7 };
      }
    }

    if (chainName.includes("Sui")) {
      const suiOwner = suiAddress || (suiIsConnected ? suiAddress : null);
      if (!suiOwner) return { balance: 0n, decimals: 6 };
      try {
        return await fetchSuiUsdcBalance(suiOwner, chainName);
      } catch (e) {
        console.error("Failed to fetch Sui USDC balance", e);
        return { balance: 0n, decimals: 6 };
      }
    }

    if (!userAddr) return { balance: 0n, decimals: assetName === "cirBTC" ? 8 : 6 };
    const conf = (CROSS_CHAIN_REGISTRY as any)[chainName];
    const assetAddr = conf?.[assetName];
    if (!conf?.rpc || !assetAddr || assetAddr === "0x0") return { balance: 0n, decimals: assetName === "cirBTC" ? 8 : 6 };

    try {
      const defaultDecimals = assetName === "cirBTC" ? 8 : 6;
      let res = { balance: 0n, decimals: defaultDecimals };
      await withEvmFailover(chainName, conf.rpc, async (rpcUrl) => {
        const pc = createPublicClient({ transport: http(rpcUrl) });
        const [b, d] = await Promise.all([
          pc.readContract({
            address: assetAddr as `0x${string}`,
            abi: ERC20_APPROVE_ABI,
            functionName: "balanceOf",
            args: [userAddr]
          }),
          pc.readContract({
            address: assetAddr as `0x${string}`,
            abi: ERC20_APPROVE_ABI,
            functionName: "decimals"
          }).catch(() => defaultDecimals)
        ]);
        res = { balance: b as bigint, decimals: Number(d) || defaultDecimals };
      }, "fetchSingleChainBalance");
      return res;
    } catch {
      console.error(`Failed to fetch EVM balance for ${chainName}`);
      return { balance: 0n, decimals: assetName === "cirBTC" ? 8 : 6 };
    }
  }, [address, effectiveAddress, solanaConnected, solanaPubkeyStr, stellarIsConnected, stellarAddress, stellarUsdcBal, suiIsConnected, suiAddress]);

  const [hasCrossChainLoaded, setHasCrossChainLoaded] = useState(false);
  const crossChainRequestIdRef = useRef<number>(0);

  const fetchCrossChainBalance = useCallback(async () => {
    if (!bridgeFromChain || !bridgeToChain || !bridgeFromAsset || !bridgeToAsset || bridgeFromChain === bridgeToChain) {
      setIsCrossChainLoading(false);
      setHasCrossChainLoaded(true);
      return;
    }
    const currentReqId = ++crossChainRequestIdRef.current;
    setIsCrossChainLoading(true);
    try {
      const fromChainTarget = bridgeFromChain;
      const toChainTarget = bridgeToChain;
      const fromAssetTarget = bridgeFromAsset;
      const toAssetTarget = bridgeToAsset;

      const [fromData, toData] = await Promise.all([
        fetchSingleChainBalance(fromChainTarget, fromAssetTarget),
        fetchSingleChainBalance(toChainTarget, toAssetTarget)
      ]);

      // Guard against stale async responses if chains/assets changed during fetch
      if (crossChainRequestIdRef.current !== currentReqId) return;

      setCrossChainBal(fromData.balance);
      setCrossChainDecimals(fromData.decimals);

      setCrossChainToBal(toData.balance);
      setCrossChainToDecimals(toData.decimals);
    } catch (err) {
      console.error("[Bridge Balance] Failed to fetch cross-chain balances:", err);
    } finally {
      if (crossChainRequestIdRef.current === currentReqId) {
        setIsCrossChainLoading(false);
        setHasCrossChainLoaded(true);
      }
    }
  }, [bridgeFromChain, bridgeToChain, bridgeFromAsset, bridgeToAsset, fetchSingleChainBalance]);

  useEffect(() => {
    fetchCrossChainBalance();
  }, [bridgeFromChain, bridgeToChain, bridgeFromAsset, bridgeToAsset, effectiveAddress, address, suiIsConnected, suiAddress, solanaConnected, solanaPubkeyStr, stellarIsConnected, stellarAddress]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const isArcNative = bridgeFromChain === "Arc Testnet";
  const decimalsFrom = crossChainDecimals;

  const isFetchingArcAddress = executionMode === "arcfun" && !arcWalletAddress && !hasCheckedArcWallet;

  const isLoadingBalance = isFetchingArcAddress || isRefreshing || (
    !!effectiveAddress && isCrossChainLoading && !hasCrossChainLoaded
  );

  // ── Rate-limited refetch (max once per 60 s; pass force=true to bypass) ──
  const REFETCH_COOLDOWN_MS = 60_000;
  const lastRefetchRef = useRef<number>(0);

  const refetchBalance = useCallback(async (force = false) => {
    const now = Date.now();
    if (!force && now - lastRefetchRef.current < REFETCH_COOLDOWN_MS) return;
    lastRefetchRef.current = now;

    setIsRefreshing(true);
    await fetchCrossChainBalance();
    setLastUpdated(new Date());
    setIsRefreshing(false);
  }, [fetchCrossChainBalance]);

  useEffect(() => {
    if (!isLoadingBalance) {
      setLastUpdated(new Date());
    }
  }, [isLoadingBalance, nativeBalData, eurcBalRaw, crossChainBal]);

  // After a successful tx: force one immediate refetch (bypasses cooldown)
  useEffect(() => {
    if (txEngine.state === "success") {
      const timer = setTimeout(() => {
        refetchBalance(true);
        window.dispatchEvent(new Event('refresh-portfolio'));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [txEngine.state, refetchBalance]);

  // Dynamic Gas Buffer calculation specifically for Arc (Mainnet & Testnet)
  // On Arc, USDC is the native gas fee token. All other chains pay gas in their own native asset (ETH, SOL, etc.).
  const [arcGasBuffer, setArcGasBuffer] = useState<number>(0.05);

  useEffect(() => {
    let isCancelled = false;
    const fetchArcGas = async () => {
      const isArc = bridgeFromChain === "Arc Mainnet" || bridgeFromChain === "Arc Testnet";
      if (!isArc) return;

      try {
        const rpc = bridgeFromChain === "Arc Mainnet"
          ? (process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || "https://arc-mainnet.g.alchemy.com/v2/Vt9_fvDipTI7hEZdMc950")
          : (process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com");

        const client = createPublicClient({ transport: http(rpc) });
        const gasPrice = await client.getGasPrice();
        // 250,000 gas limit for burn + approval + 20% safety margin
        const dynamicGasCost = (gasPrice * 250000n * 12n) / 10n;
        const dynamicUsdc = Number(dynamicGasCost) / 1e18; // Arc native currency has 18 decimals
        // Use at least 0.05 USDC, or the real dynamic gas cost if higher
        const calculatedBuffer = Math.max(0.05, dynamicUsdc);
        if (!isCancelled) {
          setArcGasBuffer(Math.round(calculatedBuffer * 10000) / 10000);
        }
      } catch (e) {
        if (!isCancelled) setArcGasBuffer(0.05);
      }
    };

    fetchArcGas();
    const interval = setInterval(fetchArcGas, 20000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [bridgeFromChain]);

  // Unified balance logic
  const balanceFromRaw: bigint = crossChainBal;
  const fromBalFormatted = formatUnits(crossChainBal, crossChainDecimals);

  const toBalFormatted = formatUnits(crossChainToBal, crossChainToDecimals);

  const bridgeAmountNum = Number(bridgeAmount) || 0;
  // If user inputs a rounded amount that is within a tiny micro-unit (<= 5 atomic units / 0.000005)
  // of their exact on-chain balance (e.g. typing "1" when on-chain balance is 0.999999), clamp to exact balance
  const parsedBridgeRaw = bridgeAmount ? parseUnits(bridgeAmount, decimalsFrom) : 0n;
  const bridgeAmountRaw = (parsedBridgeRaw > balanceFromRaw && (parsedBridgeRaw - balanceFromRaw) <= 5n)
    ? balanceFromRaw
    : parsedBridgeRaw;
  const handleMaxBridge = () => {
    const isArcNativeGas = bridgeFromChain === "Arc Mainnet" || bridgeFromChain === "Arc Testnet";
    if (bridgeFromAsset === "cirBTC") {
      setBridgeAmount(fromBalFormatted);
    } else if (isArcNativeGas) {
      // Arc chain: reserve dynamic gas buffer (min 0.05 USDC or real-time RPC gas fee)
      const totalNum = Number(fromBalFormatted);
      const safeMax = Math.max(0, Math.floor(Math.max(0, totalNum - arcGasBuffer) * 10000) / 10000);
      setBridgeAmount(safeMax.toString());
    } else {
      // Non-Arc chains (Base, Ethereum, etc.): Allow exact full balance to be bridged
      setBridgeAmount(fromBalFormatted);
    }
    handleInputFocus();
  };

  const isRouteSupported = (fromChain: string | null, toChain: string | null): boolean => {
    if (!fromChain || !toChain) return true;
    if (fromChain === toChain) return false;

    // EURC Route Validation: Both source and destination must be in EURC_CHAINS
    if (bridgeFromAsset === "EURC" || bridgeToAsset === "EURC") {
      if (!EURC_CHAINS.includes(fromChain as Chain) || !EURC_CHAINS.includes(toChain as Chain)) {
        return false;
      }
    }

    // cirBTC Route Validation: Both source and destination must be in CIRBTC_CHAINS
    if (bridgeFromAsset === "cirBTC" || bridgeToAsset === "cirBTC") {
      if (!CIRBTC_CHAINS.includes(fromChain as Chain) || !CIRBTC_CHAINS.includes(toChain as Chain)) {
        return false;
      }
    }

    const isFromSui = fromChain === "Sui Testnet";
    const isToSui = toChain === "Sui Testnet";

    const isFromStellar = fromChain === "Stellar Testnet";
    const isToStellar = toChain === "Stellar Testnet";

    const isFromSolana = fromChain.includes("Solana");
    const isToSolana = toChain.includes("Solana");

    // 0. Sui <-> Solana is NOT linked by Circle in CCTP v2 on Solana Devnet/Mainnet
    // Solana CCTP TokenMessenger fails with AnchorError 3012 (token_pair AccountNotInitialized)
    // Circle only supports Sui <-> EVM (Arc, Ethereum, Arbitrum, Base, Avalanche, etc.)
    if ((isFromSui && isToSolana) || (isFromSolana && isToSui)) {
      return false;
    }

    // 1. Sui (Circle CCTP V2 routes)
    if (isFromSui) {
      const toConfig = resolveCctpDomain(toChain, mode);
      if (!toConfig) return false;
    }
    if (isToSui) {
      const fromConfig = resolveCctpDomain(fromChain, mode);
      if (!fromConfig) return false;
    }

    // 2. Stellar Testnet
    if ((isFromStellar && (isToSolana || isToSui)) || (isToStellar && (isFromSolana || isFromSui))) {
      return false;
    }

    return true;
  };

  // Dynamic chain lists based on selected bridge asset and environment mode
  const getChains = (dir: "from" | "to"): Chain[] => {
    const allowed = getSupportedChains(mode) as readonly Chain[];
    return allowed.filter((c) => (dir === "to" ? c !== bridgeFromChain : true));
  };

  const supportedFromChains = getChains("from");
  const validDestinations = getChains("to");

  // Environment Switch Reset: completely isolate mainnet/testnet chains
  useEffect(() => {
    const allowed = getSupportedChains(mode) as readonly Chain[];
    setBridgeFromChain(allowed[0] || null);
    setBridgeToChain(allowed.length > 1 ? allowed[1] : null);
    setBridgeAmount("");
    setCrossChainBal(0n);
    setCrossChainToBal(0n);
    setHasCrossChainLoaded(false);
    setIsCrossChainLoading(true);
  }, [mode]);

  // Auto-correction: Route Guards
  useEffect(() => {
    const allowed = getSupportedChains(mode) as readonly Chain[];
    if (!bridgeFromChain || !allowed.includes(bridgeFromChain)) {
      setBridgeFromChain(allowed[0]);
    }
    if (!bridgeToChain || !allowed.includes(bridgeToChain) || bridgeToChain === bridgeFromChain) {
      const nextTo = allowed.find(c => c !== bridgeFromChain) || null;
      setBridgeToChain(nextTo as any);
    }
  }, [mode, bridgeFromChain, bridgeToChain]);

  // Auto-correction: Invalid token guard after chain switch
  useEffect(() => {
    if (!bridgeFromChain) return;

    const validFromTokens = CHAIN_TOKEN_MATRIX[bridgeFromChain] || ["USDC"];
    if (!validFromTokens.includes(bridgeFromAsset as any)) {
      setBridgeFromAsset(validFromTokens[0]); // fallback to USDC only if current source chain doesn't support the token at all
    }
  }, [bridgeFromChain, bridgeFromAsset]);

  // Keep fromAsset and toAsset always in sync for cross-chain bridging
  useEffect(() => {
    if (bridgeFromAsset && bridgeToAsset && bridgeFromAsset !== bridgeToAsset) {
      setBridgeToAsset(bridgeFromAsset);
    }
  }, [bridgeFromAsset, bridgeToAsset]);

  const handleFromChainChange = useCallback((newChain: Chain) => {
    if (newChain === bridgeFromChain) return;
    setBridgeFromChain(newChain);

    // Auto-correction to prevent Same Chain Bridge atomically
    if (newChain === bridgeToChain) {
      const allowed = getSupportedChains(mode) as readonly Chain[];
      const validDest = allowed.filter(c => c !== newChain);
      setBridgeToChain(validDest[0] || null);
    }

    const isNewChainEvm = !newChain.includes("Solana") && !newChain.includes("Stellar") && !newChain.includes("Sui");
    if (isNewChainEvm) {
      const activeDomains = getCctpDomains(mode);
      // Auto-switch wallet (Phase 3)
      const requiredChainId = CHAIN_ID_MAP[newChain] ?? activeDomains[newChain]?.chainId;
      if (requiredChainId && walletChainId !== requiredChainId && switchChainAsync) {
        switchChainAsync({ chainId: requiredChainId }).catch((err) => {
          console.error("Auto-switch failed or rejected:", err);
        });
      }
    }
  }, [bridgeFromChain, bridgeToChain, mode, walletChainId, switchChainAsync]);

  const handleToChainChange = useCallback((newChain: Chain) => {
    if (newChain === bridgeToChain) return;
    setBridgeToChain(newChain);

    // Auto-correction to prevent Same Chain Bridge atomically
    if (newChain === bridgeFromChain) {
      const allowed = getSupportedChains(mode) as readonly Chain[];
      const validSrc = allowed.filter(c => c !== newChain);
      setBridgeFromChain(validSrc[0] || null);
    }
  }, [bridgeFromChain, bridgeToChain, mode]);

  const handleFlipChains = useCallback(() => {
    if (!bridgeFromChain || !bridgeToChain) return;
    const newFrom = bridgeToChain;
    const newTo = bridgeFromChain;
    const newFromAsset = bridgeToAsset;
    const newToAsset = bridgeFromAsset;

    setBridgeFromChain(newFrom);
    setBridgeToChain(newTo);
    setBridgeFromAsset(newFromAsset);
    setBridgeToAsset(newToAsset);

    // Instantly swap in-memory balances for zero UI flicker / no same-balance bug
    setCrossChainBal(crossChainToBal);
    setCrossChainDecimals(crossChainToDecimals);
    setCrossChainToBal(crossChainBal);
    setCrossChainToDecimals(crossChainDecimals);

    setIsRotated(r => !r);

    const isNewFromEvm = !newFrom.includes("Solana") && !newFrom.includes("Stellar") && !newFrom.includes("Sui");
    if (isNewFromEvm) {
      const activeDomains = getCctpDomains(mode);
      const requiredChainId = CHAIN_ID_MAP[newFrom] ?? activeDomains[newFrom]?.chainId;
      if (requiredChainId && walletChainId !== requiredChainId && switchChainAsync) {
        switchChainAsync({ chainId: requiredChainId }).catch((err) => {
          console.error("Auto-switch failed or rejected:", err);
        });
      }
    }
  }, [bridgeFromChain, bridgeToChain, bridgeFromAsset, bridgeToAsset, crossChainBal, crossChainDecimals, crossChainToBal, crossChainToDecimals, mode, walletChainId, switchChainAsync]);

  useEffect(() => {
    if (activeTab === "bridge") {
      fetchCrossChainBalance();
    }
  }, [fetchCrossChainBalance, activeTab]);

  // ── Write contracts (kept for event listeners, engine has its own) ──────────
  const { writeContractAsync: approve } = useWriteContract();
  const { writeContractAsync: bridgeDeposit } = useWriteContract();

  const arcPublicClient = usePublicClient({ chainId: CHAIN_ID_MAP["Arc Testnet"] });

  const getBridgeButtonState = (): { text: string; disabled: boolean; isSwitch?: boolean; isTrustlineMissing?: boolean; loading?: boolean } => {
    if (!bridgeFromChain || !bridgeToChain) return { text: "Select a chain", disabled: true };

    const isSourceSolana = bridgeFromChain?.includes("Solana");
    const isDestSolana = bridgeToChain?.includes("Solana");
    const isSourceStellar = bridgeFromChain === "Stellar Testnet";
    const isDestStellar = bridgeToChain === "Stellar Testnet";
    const isSourceSui = bridgeFromChain?.includes("Sui");
    const isDestSui = bridgeToChain?.includes("Sui");
    const isSourceEVMC = !isSourceSolana && !isSourceStellar && !isSourceSui;
    const isDestEVMC = !isDestSolana && !isDestStellar && !isDestSui;

    if (!isRouteSupported(bridgeFromChain, bridgeToChain) || bridgeFromChain === bridgeToChain) {
      return { text: "Unsupported Route", disabled: true };
    }

    if (isSourceSolana && !solanaConnected) {
      return { text: "Connect Solana Wallet", disabled: false };
    }
    if (isSourceStellar && !stellarWallet.isConnected) {
      return { text: "Connect Stellar Wallet", disabled: false };
    }
    if (isSourceSui && !suiWallet.isConnected) {
      return { text: "Connect Sui Wallet", disabled: false };
    }
    if (isSourceEVMC && !address) {
      return { text: "Connect EVM Wallet", disabled: false };
    }
    if (isDestSolana && !solanaConnected) {
      return { text: "Connect Solana Wallet", disabled: false };
    }
    if (isDestStellar && !stellarWallet.isConnected) {
      return { text: "Connect Stellar Wallet", disabled: false };
    }
    if (isDestSui && !suiWallet.isConnected) {
      return { text: "Connect Sui Wallet", disabled: false };
    }
    if (isDestEVMC && !address) {
      return { text: "Connect EVM Wallet", disabled: false };
    }
    if (isDestStellar && stellarWallet.isConnected && !stellarWallet.hasUsdcTrustline) {
      return { text: "USDC Trustline Missing", disabled: true, isTrustlineMissing: true };
    }

    // ── Network safety: wallet must be on the FROM chain ──────────────────
    if (!isSourceSolana && !isSourceStellar && !isSourceSui) {
      const activeDomains = getCctpDomains(mode);
      const requiredChainId = bridgeFromChain ? (CHAIN_ID_MAP[bridgeFromChain] ?? activeDomains[bridgeFromChain]?.chainId) : undefined;
      if (requiredChainId && walletChainId !== requiredChainId) {
        return { text: `Switch to ${bridgeFromChain}`, disabled: false, isSwitch: true };
      }
    }

    if (isRouteBlocked) {
      return { text: "Temporary Unavailable", disabled: true };
    }

    if (!bridgeFromAsset || !bridgeToAsset) return { text: "Select a token", disabled: true };
    if (!bridgeAmount || bridgeAmountNum <= 0) return { text: "Enter an amount", disabled: true };
    if (bridgeAmountRaw > balanceFromRaw) return { text: "Insufficient Balance", disabled: true };
    if (isBridgeSubmitting || txEngine.state === "running") return { text: "Processing…", disabled: true, loading: true };
    if (txEngine.state === "pending") return { text: "Finalizing…", disabled: true, loading: true };
    if (txEngine.state === "claim_manual_required") return { text: "Manual Claim Required", disabled: true };
    if (txEngine.state === "success") return { text: "Success!", disabled: true, loading: false };

    // While backend relayer balance and gas eligibility is verifying, lock the slide button
    if (isGasEligibilityLoading) {
      return { text: "Verifying...", disabled: true, loading: true };
    }

    const btnText = isAdmin ? "Bridge +" : "Bridge";
    if (!isSourceSolana && !isSourceStellar && !isSourceSui && bridgeAmountRaw > bridgeAllowance) return { text: `Approve & ${btnText}`, disabled: false };
    return { text: btnText, disabled: false };
  };

  const handleBridge = useCallback(async () => {
    if (isGasEligibilityLoading || isBridgeSubmitting) return;
    if (!bridgeFromChain || !bridgeToChain || !bridgeFromAsset || !bridgeToAsset) return;
    const btnState = getBridgeButtonState();
    if (btnState.disabled && !btnState.isSwitch) return;
    const isSourceSolana = bridgeFromChain.includes("Solana");
    const isDestSolana = bridgeToChain.includes("Solana");
    const isSourceStellar = bridgeFromChain === "Stellar Testnet";
    const isDestStellar = bridgeToChain === "Stellar Testnet";
    const isSourceSui = bridgeFromChain?.includes("Sui");
    const isDestSui = bridgeToChain?.includes("Sui");

    const isSourceEVMC = !isSourceSolana && !isSourceStellar && !isSourceSui;
    const isDestEVMC = !isDestSolana && !isDestStellar && !isDestSui;

    if (isSourceSolana && !solanaConnected) {
      (window as any).__openSolanaNext = true;
      document.getElementById('wallet-dropdown-trigger')?.click();
      return;
    }
    if (isSourceStellar && !stellarWallet.isConnected) {
      (window as any).__openStellarNext = true;
      document.getElementById('wallet-dropdown-trigger')?.click();
      return;
    }
    if (isSourceSui && !suiWallet.isConnected) {
      if (suiWallet.wallets && suiWallet.wallets.length > 0) {
        suiWallet.connectWallet({ wallet: suiWallet.wallets[0] });
      } else {
        alert("Please install a Sui wallet extension (e.g. Sloth / Sui Wallet).");
      }
      return;
    }
    if (isSourceEVMC && !address) {
      document.getElementById('wallet-dropdown-trigger')?.click();
      return;
    }
    if (isDestSolana && !solanaConnected) {
      (window as any).__openSolanaNext = true;
      document.getElementById('wallet-dropdown-trigger')?.click();
      return;
    }
    if (isDestStellar && !stellarWallet.isConnected) {
      (window as any).__openStellarNext = true;
      document.getElementById('wallet-dropdown-trigger')?.click();
      return;
    }
    if (isDestSui && !suiWallet.isConnected) {
      if (suiWallet.wallets && suiWallet.wallets.length > 0) {
        suiWallet.connectWallet({ wallet: suiWallet.wallets[0] });
      } else {
        alert("Please install a Sui wallet extension (e.g. Sloth / Sui Wallet).");
      }
      return;
    }
    if (isDestEVMC && !address) {
      document.getElementById('wallet-dropdown-trigger')?.click();
      return;
    }

    const activeDomains = getCctpDomains(mode);

    if (!isSourceSolana && !isSourceStellar && !isSourceSui) {
      const requiredChainId = (bridgeFromChain ? CHAIN_ID_MAP[bridgeFromChain] : undefined) ?? (bridgeFromChain ? activeDomains[bridgeFromChain] : undefined)?.chainId;
      if (requiredChainId && walletChainId !== requiredChainId) {
        try {
          await switchChainAsync({ chainId: requiredChainId });
        } catch (e: any) {
          console.warn("switchChainAsync failed, trying window.ethereum fallback:", e);
          if (typeof window !== "undefined" && (window as any).ethereum) {
            const hexChainId = "0x" + requiredChainId.toString(16);
            try {
              await (window as any).ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: hexChainId }],
              });
            } catch (switchError: any) {
              if (switchError.code === 4902 || switchError?.message?.includes("4902") || switchError?.message?.includes("Unrecognized chain")) {
                const chainConfig = ChainRegistry.getChainSafe(bridgeFromChain);
                if (chainConfig) {
                  await (window as any).ethereum.request({
                    method: "wallet_addEthereumChain",
                    params: [{
                      chainId: hexChainId,
                      chainName: chainConfig.name,
                      nativeCurrency: chainConfig.nativeCurrency,
                      rpcUrls: [chainConfig.rpcUrl],
                      blockExplorerUrls: [ChainRegistry.getExplorerTxUrl(bridgeFromChain!, "") || "https://amoy.polygonscan.com"]
                    }]
                  });
                }
              }
            }
          }
        }
        return;
      }
    }

    if (!bridgeAmountRaw) return;
    const destChainId = (bridgeToChain ? CHAIN_ID_MAP[bridgeToChain] : undefined) ?? (bridgeToChain ? activeDomains[bridgeToChain] : undefined)?.chainId ?? (isDestSolana ? 0 : undefined);
    if (destChainId === undefined) return;

    // Removed redundant inline switch chain to prevent double-prompts,
    // it's handled by the button state now.

    setIsBridgeSubmitting(true);
    try {
      await txEngine.executeBridge({
        tokenIn: bridgeTokenAddress,
        amount: bridgeAmountRaw,
        destChainId,
        allowance: bridgeAllowance,
        route: "cctp",
        sourceChain: bridgeFromChain as any,
        destChain: bridgeToChain as any,
        fromAsset: bridgeFromAsset as any,
        toAsset: bridgeToAsset as any,
        formattedAmount: bridgeAmount,
        manualClaim: isManualClaimSelfMint,
        destAddress: (() => {
          if (bridgeToChain?.includes("Solana")) return solanaWallet?.publicKey?.toBase58() || "";
          if (bridgeToChain?.includes("Sui")) return suiWallet?.address || "";
          if (bridgeToChain?.includes("Stellar")) return stellarWallet?.address || "";
          return address || "";
        })(),
      });
    } finally {
      setIsBridgeSubmitting(false);
    }
  }, [address, bridgeAmountRaw, bridgeAllowance, bridgeTokenAddress, tokenInAddr, bridgeFromChain, bridgeToChain, bridgeFromAsset, bridgeToAsset, bridgeAmount, txEngine, walletChainId, switchChainAsync, refetchBalance, mode, isManualClaimSelfMint, isGasEligibilityLoading, isBridgeSubmitting]);

  const handleResumeBridge = useCallback(async () => {
    const targetBurnHash = txEngine.burnHash || txEngine.summary?.burnHash;
    if (!targetBurnHash) return;

    const sourceChainName = bridgeFromChain || txEngine.summary?.sourceChain || "Ethereum Sepolia";
    const destChainName = bridgeToChain || txEngine.summary?.destChain || "Arc Testnet";

    const activeDomains = getCctpDomains(mode);
    const isSourceEvm = !sourceChainName.includes("Solana") && !sourceChainName.includes("Stellar") && !sourceChainName.includes("Sui");
    const requiredChainId = (sourceChainName ? CHAIN_ID_MAP[sourceChainName] : undefined) ?? (sourceChainName ? activeDomains[sourceChainName] : undefined)?.chainId;
    if (isSourceEvm && address && requiredChainId && walletChainId !== requiredChainId) {
      try {
        await switchChainAsync({ chainId: requiredChainId });
      } catch (e) {
        console.error(e);
      }
      return;
    }

    const payload = {
      burnTxHash: targetBurnHash,
      sourceChain: sourceChainName as any,
      destChain: destChainName as any,
      amount: txEngine.summary?.fromAmt || bridgeAmount || "0",
      fromAsset: (txEngine.summary?.fromAsset || bridgeFromAsset || "USDC") as any,
      toAsset: (txEngine.summary?.toAsset || bridgeToAsset || "USDC") as any
    };

    (process.env.NODE_ENV === "development" ? console.log : () => { })("[Path A: Bridge Tab -> Try Again] resumePayload.amount:", payload.amount);
    await txEngine.executeResume(payload);
  }, [address, txEngine, bridgeFromChain, bridgeToChain, bridgeAmount, bridgeFromAsset, bridgeToAsset, walletChainId, switchChainAsync]);

  const statusColor: Record<string, string> = { ACTIVE: "#22c55e", WARNING: "#b30000", CRITICAL: "#ef4444", PAUSED: "#6b7280", DEGRADED: "#b30000", DISABLED: "#ef4444", UNKNOWN: "#6b7280" };
  const isTxActive = txEngine.state !== "idle";

  const isBridgeValid = activeTab === "bridge" && Number(bridgeAmount) > 0 && bridgeAmountRaw <= balanceFromRaw;
  const showRightPanel = isBridgeValid || isTxActive;

  useEffect(() => {
    if (txEngine.state === "success") {
      const timer = setTimeout(() => {
        setBridgeAmount("");
        txEngine.dismiss();
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [txEngine.state, txEngine]);

  // Auto-scroll to transaction tracker / progress UI when transaction or manual claim starts
  useEffect(() => {
    if (isTxActive) {
      const scrollTimer = setTimeout(() => {
        const el = document.querySelector(".right-panel-card") || document.querySelector(".tx-tracker-container");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);
      return () => clearTimeout(scrollTimer);
    }
  }, [isTxActive, txEngine.state]);

  const isTerminalError = txEngine.error && (
    txEngine.error.toLowerCase().includes("already claimed") ||
    txEngine.error.toLowerCase().includes("nonce already used") ||
    txEngine.error.toLowerCase().includes("message already received") ||
    txEngine.error.toLowerCase().includes("mint already executed") ||
    txEngine.error.toLowerCase().includes("bridge completed")
  );

  const isRecoverable = (txEngine.state === "failed" || txEngine.state === "mint_rejected") && !!txEngine.burnHash && !txEngine.mintHash && !isTerminalError;

  const { connector } = useAccount();


  return (
    <>
      <div className={`swap-bridge-container ${activeTab === "bridge" || activeTab === "recover" ? "has-right-panel" : ""}`}>
        {/* ── LEFT SIDEBAR ── */}
        <div className="swap-bridge-sidebar pt-2 md:pt-[5vh]" style={{ width: 220, display: "none", flexDirection: "column", flexShrink: 0 }}>

          {/* Brand title */}
          <div className="sb-title">
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.02em" }}>ArcFun Bridge</div>
          </div>

          {/* Nav items */}
          {(
            [
              { id: "bridge", label: "Bridge" },
              { id: "recover", label: "Recover" },
              { id: "history", label: "History" },
            ] as const
          ).filter(item => {
            if (mode === "mainnet") {
              return false;
            }
            return true;
          }).map((item, idx, arr) => (
            <Fragment key={item.id}>
              {idx > 0 && item.id === "history" && <div className="sb-divider" />}
              <button
                className={`sb-nav-btn ${activeTab === item.id ? "active" : ""}`}
                onClick={() => { setActiveTab(item.id as any); txEngine.dismiss(); }}
              >
                {item.label}
                {item.id === "history" && hasPendingBridge && (
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", backgroundColor: "#ef4444", marginLeft: 8, transform: "translateY(-1px)" }} />
                )}
              </button>
              {item.id === "bridge" && (
                <button
                  className="sb-nav-btn"
                  onClick={() => onOpenFaucetHub && onOpenFaucetHub()}
                >
                  Faucet Hub
                </button>
              )}
            </Fragment>
          ))}
        </div>

        {/* ── MAIN CONTENT ── */}
        <div
          className="swap-main-content pt-4 md:pt-[10vh] lg:pt-[14vh]"
          style={{
            flex: 1,
            width: "100%",
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            position: "relative",
            transition: "padding-left 0.3s cubic-bezier(0.22, 1, 0.36, 1)",
            paddingLeft: sidebarCollapsed ? "clamp(24px, 5.5vw, 96px)" : "0px",
          }}
        >

          {/* ── Sub-navigation Pill Bar (Bridge / Recover / History / Faucet Hub) ── */}
          <div
            className="subnav-pill-bar"
            style={{
              width: "100%",
              maxWidth: 424,
              display: "flex",
              justifyContent: "center",
              marginBottom: activeTab === "history" ? 4 : 20,
              zIndex: 20,
            }}
          >
            {/* Left: Sub-navigation Pill Bar (Bridge / Recover / History / Faucet Hub) */}
            <div
              className="subnav-pill-bar-box"
              style={{
                background: isDark ? "#151922" : "var(--surface-soft, #f1f5f9)",
                border: isDark ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid var(--border, #e2e8f0)",
                boxShadow: isDark ? "none" : "0 1px 2px rgba(0,0,0,0.02)",
              }}
            >
              <button
                onClick={() => { setActiveTab("bridge"); txEngine.dismiss(); }}
                className="subnav-pill-item hover:text-[var(--text-primary)]"
                style={{
                  fontWeight: activeTab === "bridge" ? 700 : 500,
                  background: activeTab === "bridge"
                    ? (isDark ? "#283040" : "#ffffff")
                    : "transparent",
                  color: activeTab === "bridge"
                    ? (isDark ? "#ffffff" : "#0f172a")
                    : (isDark ? "#94a3b8" : "#64748b"),
                  border: activeTab === "bridge"
                    ? (isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.08)")
                    : "1px solid transparent",
                  boxShadow: activeTab === "bridge"
                    ? (isDark ? "none" : "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)")
                    : "none",
                }}
              >
                Bridge
              </button>

              <button
                onClick={() => { setActiveTab("recover"); txEngine.dismiss(); }}
                className="subnav-pill-item hover:text-[var(--text-primary)]"
                style={{
                  fontWeight: activeTab === "recover" ? 700 : 500,
                  background: activeTab === "recover"
                    ? (isDark ? "#283040" : "#ffffff")
                    : "transparent",
                  color: activeTab === "recover"
                    ? (isDark ? "#ffffff" : "#0f172a")
                    : (isDark ? "#94a3b8" : "#64748b"),
                  border: activeTab === "recover"
                    ? (isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.08)")
                    : "1px solid transparent",
                  boxShadow: activeTab === "recover"
                    ? (isDark ? "none" : "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)")
                    : "none",
                }}
              >
                Recover
              </button>

              <button
                onClick={() => { setActiveTab("history"); txEngine.dismiss(); }}
                className="subnav-pill-item hover:text-[var(--text-primary)]"
                style={{
                  fontWeight: activeTab === "history" ? 700 : 500,
                  background: activeTab === "history"
                    ? (isDark ? "#283040" : "#ffffff")
                    : "transparent",
                  color: activeTab === "history"
                    ? (isDark ? "#ffffff" : "#0f172a")
                    : (isDark ? "#94a3b8" : "#64748b"),
                  border: activeTab === "history"
                    ? (isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.08)")
                    : "1px solid transparent",
                  boxShadow: activeTab === "history"
                    ? (isDark ? "none" : "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)")
                    : "none",
                }}
              >
                <span>History</span>
                {hasPendingBridge && (
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", backgroundColor: "#ef4444" }} />
                )}
              </button>

              {mode !== "mainnet" && onOpenFaucetHub && (
                <button
                  onClick={() => onOpenFaucetHub()}
                  className="subnav-pill-item hover:text-[var(--text-primary)]"
                  style={{
                    background: "transparent",
                    color: isDark ? "#94a3b8" : "#64748b",
                    border: "1px solid transparent",
                  }}
                >
                  Faucet Hub
                </button>
              )}
            </div>
          </div>

          {/* Main Bridge Workspace (2-Column >1150px, stacked <1150px) */}
          {activeTab !== "history" && (
            <div className="bridge-desktop-workspace w-full max-w-[1440px] flex flex-col min-[1150px]:flex-row items-start justify-start gap-8 min-[1150px]:gap-12">
              {/* LEFT: Bridge Card & Details */}
              <div
                className="swap-card-wrapper"
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  gap: 16,
                  width: "100%",
                  maxWidth: 424,
                  margin: 0,
                  flexShrink: 0,
                }}
              >
                {activeTab !== "recover" && (
                  <div
                    className="lf-card swap-main-card"
                    style={{
                      overflow: activeTab === "admin" ? "hidden" : "visible",
                      padding: 24,
                      display: "flex",
                      flexDirection: "column",
                      gap: 20,
                      borderRadius: 24,
                      background: "var(--surface-glass)",
                      border: "1px solid var(--border)",
                      boxShadow: "0 8px 30px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.04)",
                      ...(activeTab === "bridge"
                        ? {
                          width: "100%",
                          maxWidth: 424,
                          flexShrink: 0,
                          position: "relative",
                          zIndex: (showFromChainPicker || showToChainPicker) ? 100 : 10,
                        }
                        : activeTab === "admin"
                          ? { width: "100%", height: "calc(100vh - 140px)", maxHeight: "calc(100vh - 140px)" }
                          : { width: "100%" })
                    }}
                  >
                    {(activeTab === "admin" || activeTab === "bridge") && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
                        <div className="bridge-header-title" style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>
                          {activeTab === "bridge" ? (
                            <>
                              <span className="hidden md:inline">Cross-chain transfers</span>
                              <span className="md:hidden">Bridge</span>
                            </>
                          ) : "Protocol Liquidity & Health"}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {lastUpdated && (
                            <span className="bridge-header-time" style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              <span className="hidden md:inline">Last updated: </span>
                              {lastUpdated.toLocaleTimeString()}
                            </span>
                          )}
                          <button onClick={() => refetchBalance(isAdmin)} disabled={isRefreshing}
                            className="bridge-refresh-btn"
                            style={{ width: 32, height: 32, borderRadius: 10, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "var(--text-muted)" }}>
                            <RefreshCw size={14} style={{ animation: isRefreshing ? "spin 1s linear infinite" : "none" }} />
                          </button>
                        </div>
                      </div>
                    )}



                    {/* ── BRIDGE TAB ── */}
                    {activeTab === "bridge" && (
                      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>

                        {isRecoverable && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              padding: "6px 8px",
                              gap: 10,
                              background: "transparent",
                              marginBottom: 4,
                              width: "100%"
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                              <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" }}>
                                Pending Funds Available
                              </div>
                              <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.2 }}>
                                Recover funds in one click
                              </div>
                            </div>
                            <button
                              onClick={async () => {
                                if (isClaiming) return;
                                setIsClaiming(true);
                                await refetchHistory(true);
                                setActiveTab("history");
                                setHistoryFilter("pending");
                                txEngine.dismiss();
                                setIsClaiming(false);
                              }}
                              disabled={isClaiming}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 6,
                                padding: "5px 13px",
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--text-primary)",
                                background: "var(--bg-secondary, rgba(0, 0, 0, 0.05))",
                                border: "1px solid var(--border)",
                                borderRadius: 9999,
                                cursor: isClaiming ? "not-allowed" : "pointer",
                                boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
                                whiteSpace: "nowrap",
                                flexShrink: 0,
                                opacity: isClaiming ? 0.7 : 1,
                                transition: "all 0.15s ease"
                              }}
                            >
                              <span>{isClaiming ? "Loading..." : "Claim Funds"}</span>
                            </button>
                          </div>
                        )}


                        <div className="swap-input-box" style={{ padding: 14, borderRadius: 20, border: bridgeAmountRaw > balanceFromRaw ? "1px solid rgba(239,68,68,0.5)" : undefined }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                            <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>From</span>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                              {(isRefreshing || (isCrossChainLoading && !hasCrossChainLoaded)) && !!bridgeFromAsset ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : null}
                              {!!bridgeFromAsset && (
                                <>
                                  Balance: {formatAssetBalance(fromBalFormatted, bridgeFromAsset)}
                                  <button onClick={handleMaxBridge} style={{ background: "transparent", border: "none", padding: 0, fontSize: 11, fontWeight: 700, color: "var(--text-primary)", cursor: "pointer" }}>MAX</button>
                                </>
                              )}
                            </div>
                          </div>
                          {/* Custom From-Chain Picker */}
                          <div style={{ position: "relative", marginBottom: 8 }}>
                            <button
                              className="chain-picker-btn"
                              onClick={() => { setShowFromChainPicker(p => !p); setShowToChainPicker(false); }}
                              style={{
                                width: "100%", display: "flex", alignItems: "center", gap: 10,
                                borderRadius: 14, padding: "10px 14px", cursor: "pointer",
                                color: "var(--text-primary)", fontWeight: 700, fontSize: 15,
                                justifyContent: "space-between",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                {bridgeFromChain && (
                                  <img src={bridgeFromChain ? CHAIN_LOGOS[bridgeFromChain as Chain] : undefined} alt={bridgeFromChain || "Chain"}
                                    style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }}
                                    onError={e => { e.currentTarget.src = "/globe.svg"; }} />
                                )}
                                {bridgeFromChain || "Select chain"}
                              </div>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                                style={{ opacity: 0.5, transform: showFromChainPicker ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>

                            {showFromChainPicker && (
                              <>
                                <div className="chain-picker-backdrop" onClick={(e) => { e.stopPropagation(); setShowFromChainPicker(false); }} />
                                <div className="chain-picker-dropdown" style={{
                                  position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                                  background: "var(--surface)", border: "1px solid var(--border)",
                                  borderRadius: 18, padding: 6, overflowY: "auto", overflowX: "hidden", maxHeight: 280, zIndex: 9999,
                                  boxShadow: "0 16px 36px -4px rgba(0,0,0,0.24), 0 0 0 1px var(--border-soft)",
                                  animation: "txIn 0.18s cubic-bezier(0,0,0.2,1)",
                                }}>
                                  {supportedFromChains.map(c => {
                                    const isSelected = c === bridgeFromChain;
                                    return (
                                      <button key={c}
                                        onClick={() => {
                                          handleFromChainChange(c);
                                          setShowFromChainPicker(false);
                                        }}
                                        style={{
                                          width: "100%", display: "flex", alignItems: "center", gap: 12,
                                          padding: "10px 14px", borderRadius: 12,
                                          background: isSelected ? "var(--bg-default, rgba(128,128,128,0.08))" : "transparent",
                                          border: "none", cursor: "pointer",
                                          color: "var(--text-primary)",
                                          fontWeight: isSelected ? 700 : 500, fontSize: 14,
                                          fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                                          textAlign: "left", transition: "background 0.15s",
                                        }}
                                      >
                                        <img src={CHAIN_LOGOS[c]} alt={c}
                                          style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                                          onError={e => { e.currentTarget.src = "/globe.svg"; }} />
                                        <span>{c}</span>
                                        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                                          {L1_CHAINS.has(c) && (
                                            <span style={{
                                              fontSize: 10,
                                              fontWeight: 600,
                                              letterSpacing: "0.02em",
                                              color: "#ffffff",
                                              background: "rgba(255, 255, 255, 0.07)",
                                              border: "1px solid rgba(255, 255, 255, 0.16)",
                                              borderRadius: 9999,
                                              padding: "2px 8px",
                                              lineHeight: 1.4,
                                            }}>Fast</span>
                                          )}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ position: "relative" }}>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isFromTokenDropdownAvailable) {
                                    setShowBridgeTokenDropdown(prev => !prev);
                                    setShowBridgeToTokenDropdown(false);
                                  }
                                }}
                                className="token-selector-box"
                                style={{
                                  display: "flex", alignItems: "center", gap: 8, borderRadius: 99, padding: "8px 16px",
                                  cursor: isFromTokenDropdownAvailable ? "pointer" : "default",
                                  fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", flexShrink: 0,
                                  background: isFromTokenDropdownAvailable ? "var(--border-soft)" : undefined,
                                  border: isFromTokenDropdownAvailable ? "1px solid var(--border)" : "1px solid transparent",
                                  color: "var(--text-primary)",
                                  transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
                                }}
                              >
                                <img
                                  src={bridgeFromAsset ? (TOKEN_LOGOS[bridgeFromAsset] || "/usdc.png") : "/usdc.png"}
                                  alt={(bridgeFromAsset || "USDC") as string}
                                  style={{ width: 24, height: 24, borderRadius: "50%" }}
                                  onError={(e) => { e.currentTarget.src = "/globe.svg"; }}
                                />
                                <span>{(bridgeFromAsset || "USDC") as string}</span>
                                {isFromTokenDropdownAvailable && (
                                  <ChevronDown
                                    size={14}
                                    style={{
                                      opacity: 0.6,
                                      transform: showBridgeTokenDropdown ? "rotate(180deg)" : "none",
                                      transition: "transform 0.2s"
                                    }}
                                  />
                                )}
                              </button>

                              {showBridgeTokenDropdown && isFromTokenDropdownAvailable && (
                                <>
                                  <div
                                    className="chain-picker-backdrop"
                                    onClick={(e) => { e.stopPropagation(); setShowBridgeTokenDropdown(false); }}
                                  />
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: "calc(100% + 6px)",
                                      left: 0,
                                      minWidth: 160,
                                      background: "var(--surface)",
                                      border: "1px solid var(--border)",
                                      borderRadius: 16,
                                      padding: 6,
                                      zIndex: 9999,
                                      boxShadow: "0 16px 36px -4px rgba(0,0,0,0.3), 0 0 0 1px var(--border-soft)",
                                      animation: "txIn 0.18s cubic-bezier(0,0,0.2,1)",
                                    }}
                                  >
                                    {((bridgeFromChain ? CHAIN_TOKEN_MATRIX[bridgeFromChain] : (["USDC", "EURC", "cirBTC"] as Asset[])) || (["USDC"] as Asset[])).map(asset => {
                                      const isSelected = bridgeFromAsset === asset;
                                      return (
                                        <button
                                          key={asset}
                                          type="button"
                                          onClick={() => handleSelectFromToken(asset)}
                                          style={{
                                            width: "100%",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 10,
                                            padding: "8px 12px",
                                            borderRadius: 12,
                                            border: "none",
                                            background: isSelected ? "var(--border-soft)" : "transparent",
                                            cursor: "pointer",
                                            color: "var(--text-primary)",
                                            fontWeight: isSelected ? 800 : 600,
                                            fontSize: 14,
                                            textAlign: "left",
                                            transition: "background 0.15s"
                                          }}
                                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--border-soft)"; }}
                                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                                        >
                                          <img
                                            src={TOKEN_LOGOS[asset]}
                                            alt={asset}
                                            style={{ width: 22, height: 22, borderRadius: "50%" }}
                                            onError={(e) => { e.currentTarget.src = "/globe.svg"; }}
                                          />
                                          <div style={{ display: "flex", flexDirection: "column" }}>
                                            <span>{asset}</span>
                                            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
                                              {asset === "USDC" ? "USD Coin" : "Euro Coin"}
                                            </span>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                            <input className="swap-input-text" type="number" placeholder="0" value={bridgeAmount}
                              onChange={e => {
                                const val = e.target.value;
                                if (val === "" || parseFloat(val) >= 0) {
                                  setBridgeAmount(val);
                                  if (txEngine.state === "failed" || txEngine.state === "success") {
                                    txEngine.dismiss();
                                    txTrackerRef.current?.dismiss();
                                  }
                                }
                              }}
                              onKeyDown={e => { if (e.key === "-" || e.key === "e") e.preventDefault(); }}
                              onFocus={handleInputFocus}
                              style={{ background: "transparent", border: "none", fontSize: 36, fontWeight: 800, color: "var(--text-primary)", outline: "none", width: "50%", textAlign: "right" }} />
                          </div>
                        </div>

                        <div className="swap-center-btn" style={{ display: "flex", justifyContent: "center", margin: "-14px 0", position: "relative", zIndex: 20 }}>
                          <button onClick={handleFlipChains}
                            className="swap-flip-btn"
                            style={{ borderRadius: "50%", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 10, color: "var(--text-primary)", transition: "transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), background 0.2s, color 0.2s", transform: isRotated ? "rotate(180deg)" : "rotate(0deg)" }}
                          >
                            <ArrowUpDown size={16} />
                          </button>
                        </div>

                        <div className="swap-input-box" style={{ padding: 14, borderRadius: 20 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>To</span>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                              {(isRefreshing || (isCrossChainLoading && !hasCrossChainLoaded)) && !!bridgeToAsset ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : null}
                              {!!bridgeToAsset && (
                                <span>
                                  Balance: {formatAssetBalance(toBalFormatted, bridgeToAsset)}
                                </span>
                              )}
                            </div>
                          </div>
                          {/* Custom To-Chain Picker */}
                          <div style={{ position: "relative", marginBottom: 8 }}>
                            <button
                              className="chain-picker-btn"
                              onClick={() => { setShowToChainPicker(p => !p); setShowFromChainPicker(false); }}
                              style={{
                                width: "100%", display: "flex", alignItems: "center", gap: 10,
                                borderRadius: 14, padding: "10px 14px", cursor: "pointer",
                                color: "var(--text-primary)", fontWeight: 700, fontSize: 15,
                                justifyContent: "space-between",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                {bridgeToChain && (
                                  <img src={bridgeToChain ? CHAIN_LOGOS[bridgeToChain as Chain] : undefined} alt={bridgeToChain || "Chain"}
                                    style={{ width: 24, height: 24, borderRadius: "50%", objectFit: "cover" }}
                                    onError={e => { e.currentTarget.src = "/globe.svg"; }} />
                                )}
                                {bridgeToChain || "Select chain"}
                              </div>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                                style={{ opacity: 0.5, transform: showToChainPicker ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }}>
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>

                            {showToChainPicker && (
                              <>
                                <div className="chain-picker-backdrop" onClick={(e) => { e.stopPropagation(); setShowToChainPicker(false); }} />
                                <div className="chain-picker-dropdown" style={{
                                  position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0,
                                  background: "var(--surface)", border: "1px solid var(--border)",
                                  borderRadius: 18, padding: 6, overflowY: "auto", overflowX: "hidden", maxHeight: 280, zIndex: 9999,
                                  boxShadow: "0 16px 36px -4px rgba(0,0,0,0.24), 0 0 0 1px var(--border-soft)",
                                  animation: "txIn 0.18s cubic-bezier(0,0,0.2,1)",
                                }}>
                                  {validDestinations.map(c => {
                                    const isSelected = c === bridgeToChain;
                                    return (
                                      <button key={c}
                                        onClick={() => {
                                          handleToChainChange(c as Chain);
                                          setShowToChainPicker(false);
                                        }}
                                        style={{
                                          width: "100%", display: "flex", alignItems: "center", gap: 12,
                                          padding: "10px 14px", borderRadius: 12,
                                          background: isSelected ? "var(--bg-default, rgba(128,128,128,0.08))" : "transparent",
                                          border: "none", cursor: "pointer",
                                          color: "var(--text-primary)",
                                          fontWeight: isSelected ? 700 : 500, fontSize: 14,
                                          fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                                          textAlign: "left", transition: "background 0.15s",
                                        }}
                                      >
                                        <img src={CHAIN_LOGOS[c]} alt={c}
                                          style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                                          onError={e => { e.currentTarget.src = "/globe.svg"; }} />
                                        <span>{c}</span>
                                        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
                                          {L1_CHAINS.has(c) && (
                                            <span style={{
                                              fontSize: 10,
                                              fontWeight: 600,
                                              letterSpacing: "0.02em",
                                              color: "#ffffff",
                                              background: "rgba(255, 255, 255, 0.07)",
                                              border: "1px solid rgba(255, 255, 255, 0.16)",
                                              borderRadius: 9999,
                                              padding: "2px 8px",
                                              lineHeight: 1.4,
                                            }}>Fast</span>
                                          )}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ position: "relative" }}>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isToTokenDropdownAvailable) {
                                    setShowBridgeToTokenDropdown(prev => !prev);
                                    setShowBridgeTokenDropdown(false);
                                  }
                                }}
                                className="token-selector-box"
                                style={{
                                  display: "flex", alignItems: "center", gap: 8, borderRadius: 99, padding: "8px 16px",
                                  cursor: isToTokenDropdownAvailable ? "pointer" : "default",
                                  fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", flexShrink: 0,
                                  background: isToTokenDropdownAvailable ? "var(--border-soft)" : undefined,
                                  border: isToTokenDropdownAvailable ? "1px solid var(--border)" : "1px solid transparent",
                                  color: "var(--text-primary)",
                                  transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)"
                                }}
                              >
                                <img
                                  src={bridgeToAsset ? (TOKEN_LOGOS[bridgeToAsset] || "/usdc.png") : "/usdc.png"}
                                  alt={(bridgeToAsset || "USDC") as string}
                                  style={{ width: 24, height: 24, borderRadius: "50%" }}
                                  onError={(e) => { e.currentTarget.src = "/globe.svg"; }}
                                />
                                <span>{(bridgeToAsset || "USDC") as string}</span>
                                {isToTokenDropdownAvailable && (
                                  <ChevronDown
                                    size={14}
                                    style={{
                                      opacity: 0.6,
                                      transform: showBridgeToTokenDropdown ? "rotate(180deg)" : "none",
                                      transition: "transform 0.2s"
                                    }}
                                  />
                                )}
                              </button>

                              {showBridgeToTokenDropdown && isToTokenDropdownAvailable && (
                                <>
                                  <div
                                    className="chain-picker-backdrop"
                                    onClick={(e) => { e.stopPropagation(); setShowBridgeToTokenDropdown(false); }}
                                  />
                                  <div
                                    style={{
                                      position: "absolute",
                                      top: "calc(100% + 6px)",
                                      left: 0,
                                      minWidth: 160,
                                      background: "var(--surface)",
                                      border: "1px solid var(--border)",
                                      borderRadius: 16,
                                      padding: 6,
                                      zIndex: 9999,
                                      boxShadow: "0 16px 36px -4px rgba(0,0,0,0.3), 0 0 0 1px var(--border-soft)",
                                      animation: "txIn 0.18s cubic-bezier(0,0,0.2,1)",
                                    }}
                                  >
                                    {((bridgeToChain ? CHAIN_TOKEN_MATRIX[bridgeToChain] : (["USDC", "EURC", "cirBTC"] as Asset[])) || (["USDC"] as Asset[])).map(asset => {
                                      const isSelected = bridgeToAsset === asset;
                                      return (
                                        <button
                                          key={asset}
                                          type="button"
                                          onClick={() => handleSelectToToken(asset)}
                                          style={{
                                            width: "100%",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 10,
                                            padding: "8px 12px",
                                            borderRadius: 12,
                                            border: "none",
                                            background: isSelected ? "var(--border-soft)" : "transparent",
                                            cursor: "pointer",
                                            color: "var(--text-primary)",
                                            fontWeight: isSelected ? 800 : 600,
                                            fontSize: 14,
                                            textAlign: "left",
                                            transition: "background 0.15s"
                                          }}
                                          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "var(--border-soft)"; }}
                                          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = "transparent"; }}
                                        >
                                          <img
                                            src={TOKEN_LOGOS[asset]}
                                            alt={asset}
                                            style={{ width: 22, height: 22, borderRadius: "50%" }}
                                            onError={(e) => { e.currentTarget.src = "/globe.svg"; }}
                                          />
                                          <div style={{ display: "flex", flexDirection: "column" }}>
                                            <span>{asset}</span>
                                            <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>
                                              {asset === "USDC" ? "USD Coin" : "Euro Coin"}
                                            </span>
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </>
                              )}
                            </div>
                            <input className="swap-input-text" type="number" readOnly value={bridgeAmount}
                              style={{ background: "transparent", border: "none", fontSize: 36, fontWeight: 800, color: "var(--text-muted)", outline: "none", width: "50%", textAlign: "right" }} />
                          </div>
                        </div>

                        {/* Percentage Slider */}
                        {(() => {
                          const isArcNativeGas = bridgeFromChain === "Arc Mainnet" || bridgeFromChain === "Arc Testnet";
                          const totalBal = Number(fromBalFormatted);
                          // For Arc, the max bridgeable pool is (total - arcGasBuffer).
                          // For other chains, the max bridgeable pool is totalBal.
                          const maxUsableBal = isArcNativeGas
                            ? Math.max(0, Math.floor(Math.max(0, totalBal - arcGasBuffer) * 10000) / 10000)
                            : totalBal;

                          const currentAmt = Number(bridgeAmount);
                          let sliderPercent = 0;
                          if (maxUsableBal > 0 && currentAmt > 0) {
                            sliderPercent = Math.min(100, Math.max(0, Math.round((currentAmt / maxUsableBal) * 100)));
                          }

                          return (
                            <div style={{ margin: "14px 6px 4px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14 }}>
                              <input
                                type="range"
                                min="0"
                                max="100"
                                className="bridge-slider"
                                value={sliderPercent}
                                onChange={(e) => {
                                  const percent = Number(e.target.value);
                                  if (totalBal > 0) {
                                    if (isArcNativeGas) {
                                      // On Arc: reserve dynamic gas buffer (min 0.05 USDC or real-time RPC gas fee)
                                      if (percent === 100) {
                                        setBridgeAmount(maxUsableBal.toString());
                                      } else {
                                        const precision = bridgeFromAsset === "cirBTC" ? 100000000 : 10000;
                                        let val = Math.floor(maxUsableBal * (percent / 100) * precision) / precision;
                                        setBridgeAmount(val > 0 ? val.toString() : (percent === 0 ? "" : "0"));
                                      }
                                    } else {
                                      // Non-Arc chains: Allow 100% full balance without deducting any buffer
                                      if (percent === 100) {
                                        setBridgeAmount(fromBalFormatted);
                                      } else {
                                        const precision = bridgeFromAsset === "cirBTC" ? 100000000 : 10000;
                                        let val = Math.floor(totalBal * (percent / 100) * precision) / precision;
                                        setBridgeAmount(val > 0 ? val.toString() : (percent === 0 ? "" : "0"));
                                      }
                                    }
                                    if (txEngine.state === "failed" || txEngine.state === "success") {
                                      txEngine.dismiss();
                                      txTrackerRef.current?.dismiss();
                                    }
                                  }
                                }}
                                style={{
                                  flex: 1,
                                  cursor: "pointer",
                                  accentColor: "#2563eb",
                                  height: 5,
                                  borderRadius: 99,
                                  outline: "none",
                                  background: `linear-gradient(to right, var(--slider-fill, #2563eb) 0%, var(--slider-fill, #2563eb) ${sliderPercent}%, var(--slider-track, rgba(0, 0, 0, 0.08)) ${sliderPercent}%, var(--slider-track, rgba(0, 0, 0, 0.08)) 100%)`,
                                  ['--slider-pct' as any]: `${sliderPercent}%`
                                }}
                              />
                              <span style={{
                                fontSize: 13,
                                color: "var(--text-primary)",
                                fontWeight: 700,
                                minWidth: "36px",
                                textAlign: "right"
                              }}>
                                {sliderPercent}%
                              </span>
                            </div>
                          );
                        })()}

                        {/* ── CCTP Manual Claim (Self-Mint) Card ── */}
                        {bridgeToChain && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              paddingTop: 8,
                              marginTop: 6,
                              borderTop: "1px solid var(--border)",
                            }}
                          >
                            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                              <span style={{ color: "var(--text-primary)", fontWeight: 600, fontSize: 12, whiteSpace: "nowrap" }}>
                                Manual Claim (Self-Mint)
                              </span>
                              <span style={{ color: "var(--text-muted)" }} className="text-[10.5px] sm:text-[11px] whitespace-nowrap truncate max-w-[210px] sm:max-w-none">
                                {isGasEligibilityLoading
                                  ? "Checking backend gas..."
                                  : gasEligibility?.isManualClaimRequired
                                  ? (gasEligibility.manualClaimReason === "Insufficient relayer balance"
                                      ? "Backend gas very low · Required"
                                      : `${gasEligibility.manualClaimReason} · Required`)
                                  : isManualClaimSelfMint
                                  ? "Self-mint enabled · Pay own destination gas"
                                  : "Free auto-sponsored gas"}
                              </span>
                            </div>
                            <button
                              type="button"
                              disabled={isTxActive || gasEligibility?.isManualClaimRequired || isGasEligibilityLoading}
                              onClick={() => {
                                if (isTxActive || gasEligibility?.isManualClaimRequired || isGasEligibilityLoading) return;
                                setIsManualClaimSelfMint(!isManualClaimSelfMint);
                              }}
                              title={
                                isGasEligibilityLoading
                                  ? "Checking backend gas..."
                                  : gasEligibility?.isManualClaimRequired
                                  ? `Manual claim required: ${gasEligibility.manualClaimReason}`
                                  : isTxActive
                                  ? "Manual claim setting is locked while transfer is executing"
                                  : "Toggle Manual Claim (Self-Mint)"
                              }
                              style={{
                                width: 38,
                                height: 22,
                                borderRadius: 999,
                                border: "none",
                                backgroundColor: isManualClaimSelfMint ? "#10b981" : "#A6ACB5",
                                transition: "background-color 0.2s ease",
                                padding: 2,
                                display: "flex",
                                alignItems: "center",
                                flexShrink: 0,
                                position: "relative",
                                cursor: (isTxActive || gasEligibility?.isManualClaimRequired || isGasEligibilityLoading) ? "not-allowed" : "pointer",
                                opacity: (isTxActive || isGasEligibilityLoading) ? 0.6 : 1,
                              }}
                              className={!isManualClaimSelfMint ? "dark:!bg-zinc-600" : ""}
                            >
                              <motion.div
                                animate={{ x: isManualClaimSelfMint ? 16 : 0 }}
                                transition={{ type: "spring", stiffness: 500, damping: 32 }}
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: "50%",
                                  backgroundColor: "#ffffff",
                                  boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
                                }}
                              />
                            </button>
                          </div>
                        )}

                        {getBridgeButtonState().isTrustlineMissing ? (
                          <div style={{ marginTop: 12 }}>
                            <StellarTrustlineAction
                              stellarWallet={stellarWallet}
                              onVerify={async () => {
                                await stellarWallet.refreshBalances();
                              }}
                            />
                          </div>
                        ) : (
                          <div style={{ marginTop: 12 }}>
                            {getBridgeButtonState().isSwitch || getBridgeButtonState().text.includes("Connect") ? (
                              <ConnectWalletButton text={getBridgeButtonState().text} onClick={handleBridge} />
                            ) : (
                              <SlideButton
                                disabled={getBridgeButtonState().disabled}
                                onComplete={handleBridge}
                                loading={getBridgeButtonState().loading || false}
                                text={getBridgeButtonState().text}
                                loadingText={getBridgeButtonState().text}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── QUOTE / ROUTE DETAILS / TX TRACKER (DOWN SIDE) ── */}
                {(activeTab === "bridge") && showRightPanel && (
                  <div
                    className={`lf-card right-panel-card w-full shrink-0 flex flex-col gap-4 ${showRightPanel ? "is-visible" : ""}`}
                    style={{
                      position: "relative",
                      width: "100%",
                      maxWidth: 424,
                      padding: isTxActive ? 20 : 24,
                      background: "var(--surface-glass)",
                      border: "1px solid var(--border)",
                      borderRadius: 24,
                      boxShadow: "none",
                      zIndex: 10,
                    }}
                  >
                    {isTxActive ? (
                      <TxTracker
                        ref={txTrackerRef}
                        state={txEngine.state}
                        milestones={txEngine.milestones}
                        txHash={txEngine.txHash}
                        burnHash={txEngine.burnHash}
                        mintHash={txEngine.mintHash}
                        error={txEngine.error}
                        totalMs={txEngine.totalMs}
                        blockNumber={txEngine.blockNumber}
                        summary={txEngine.summary || (bridgeAmount ? {
                          fromAmt: bridgeAmount,
                          fromAsset: bridgeFromAsset || "USDC",
                          toAmt: bridgeAmount,
                          toAsset: bridgeToAsset || "USDC",
                          type: "bridge" as const,
                          sourceChain: bridgeFromChain ?? undefined,
                          destChain: bridgeToChain ?? undefined
                        } : null)}
                        gasUsed={txEngine.gasUsed}
                        gasPricePaid={txEngine.gasPricePaid}
                        onDismiss={() => {
                          txEngine.dismiss();
                        }}
                        onViewHistory={() => {
                          txEngine.dismiss();
                          setHistoryFilter("pending");
                          refetchHistory();
                          setActiveTab("history");
                        }}
                        onRetry={() => {
                          if (txEngine.burnHash) handleResumeBridge();
                          else handleBridge();
                        }}
                        onManualClaim={() => {
                          txEngine.executeManualClaim();
                        }}
                        flat={true}
                      />
                    ) : (
                      <>
                        <h3 style={{ fontSize: 15, fontWeight: 800, color: "var(--text-primary)", margin: 0, display: "flex", alignItems: "center", gap: 8 }}>
                          Route Details
                        </h3>

                        <div className="route-details-table" style={{ display: "flex", flexDirection: "column", gap: 0, background: "var(--surface)", borderRadius: 16, border: "1px solid var(--border)", overflow: "hidden" }}>

                          {/* Expected Output */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
                            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Expected Output</span>
                            <span style={{ fontSize: 14, fontWeight: 800, color: "var(--text-primary)" }}>
                              {bridgeAmount ? `${bridgeAmount} ${bridgeToAsset || "USDC"}` : `0.00 ${bridgeToAsset || "USDC"}`}
                            </span>
                          </div>

                          {/* Via — Circle CCTP V2 */}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
                                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Via</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                  <img
                                    src="/circle-brand.png"
                                    alt="Circle"
                                    style={{ width: 18, height: 18, objectFit: "contain", flexShrink: 0 }}
                                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                                  />
                                  <span style={{
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: "var(--text-primary)",
                                    letterSpacing: "-0.01em"
                                  }}>
                                    CCTP V2
                                  </span>
                                </div>
                              </div>

                              {/* Route — with chain logos */}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border-soft)", gap: 8 }}>
                                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600, flexShrink: 0 }}>Route</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", flexWrap: "nowrap", flexShrink: 0 }}>
                                  <img src={(bridgeFromChain ? (bridgeFromChain ? CHAIN_LOGOS[bridgeFromChain as Chain] : undefined) : undefined)} alt={bridgeFromChain || "Chain"}
                                    style={{ width: 14, height: 14, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                                    onError={(e) => { e.currentTarget.src = "/globe.svg"; }} />
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                                    {bridgeFromChain?.replace(" Mainnet", "").replace(" Sepolia", "").replace(" Testnet", "").replace(" Devnet", "")}
                                  </span>
                                  <span style={{ fontSize: 12, color: "var(--text-muted)", margin: "0 2px", flexShrink: 0 }}>→</span>
                                  <img src={(bridgeToChain ? (bridgeToChain ? CHAIN_LOGOS[bridgeToChain as Chain] : undefined) : undefined)} alt={bridgeToChain || "Chain"}
                                    style={{ width: 14, height: 14, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                                    onError={(e) => { e.currentTarget.src = "/globe.svg"; }} />
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", whiteSpace: "nowrap" }}>
                                    {bridgeToChain?.replace(" Mainnet", "").replace(" Sepolia", "").replace(" Testnet", "").replace(" Devnet", "")}
                                  </span>
                                </div>
                              </div>

                              {/* Estimated Time */}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
                                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Estimated Time</span>
                                <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                                  ~ 2 - 5 mins
                                </span>
                              </div>

                              {/* Est. Network Fee */}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                                  <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Est. Network Fee</span>
                                  {isFeeRefreshing && (
                                    <span
                                      title="Live updating every 10s"
                                      style={{
                                        display: "inline-block",
                                        width: 9,
                                        height: 9,
                                        borderRadius: "50%",
                                        border: "1.5px solid var(--text-primary)",
                                        borderTopColor: "transparent",
                                        animation: "spin 0.7s linear infinite"
                                      }}
                                    />
                                  )}
                                </div>
                                <div style={{ display: "flex", alignItems: "center" }}>
                                  {bridgeEstimate && bridgeEstimate.gasFees && bridgeEstimate.gasFees.length > 0 ? (() => {
                                    const srcGas = bridgeEstimate.gasFees.find((gf: any) => !gf.name?.toLowerCase().includes("destination") && !gf.token?.toLowerCase().includes("sponsored")) || bridgeEstimate.gasFees[0];
                                    const feeVal = srcGas?.fees?.fee ?? srcGas?.fee ?? srcGas?.amount;
                                    const tokenSymbol = srcGas?.token || (bridgeFromChain === "Arc Mainnet" ? "USDC" : "ETH");
                                    const formattedVal = (feeVal !== undefined && feeVal !== null && !isNaN(Number(feeVal)))
                                      ? Number(feeVal) < 0.0001 ? Number(feeVal).toFixed(5) : Number(feeVal).toFixed(4)
                                      : "0.0045";
                                    return (
                                      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>
                                        {formattedVal} {tokenSymbol}
                                      </span>
                                    );
                                  })() : bridgeAmountRaw > 0n ? (
                                    <span style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5 }}>
                                      <span
                                        style={{
                                          display: "inline-block",
                                          width: 8,
                                          height: 8,
                                          borderRadius: "50%",
                                          border: "1.5px solid var(--text-muted)",
                                          borderTopColor: "transparent",
                                          animation: "spin 0.7s linear infinite"
                                        }}
                                      />
                                      Estimating...
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Enter amount to estimate</span>
                                  )}
                                </div>
                              </div>

                              {/* Destination Fee */}
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: "1px solid var(--border-soft)" }}>
                                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Destination Fee</span>
                                {isManualClaimSelfMint || gasEligibility?.isManualClaimRequired ? (
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 5 }}>
                                    <span>User Pays Gas</span>
                                    {gasEligibility?.totalEstimatedClaimFeeUsd !== undefined && gasEligibility.totalEstimatedClaimFeeUsd > 0 && (
                                      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text-muted)" }}>
                                        (~${gasEligibility.totalEstimatedClaimFeeUsd < 0.01 ? "<0.01" : gasEligibility.totalEstimatedClaimFeeUsd.toFixed(3)})
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span style={{ fontSize: 12, fontWeight: 700, color: "#10b981", display: "flex", alignItems: "center", gap: 4 }}>
                                    Sponsored ($0.00)
                                  </span>
                                )}
                              </div>

                          {/* Platform Fee */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px" }}>
                            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Platform Fee</span>
                            <span style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: "var(--text-primary)",
                              fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                              fontVariantNumeric: "tabular-nums",
                              letterSpacing: "-0.01em"
                            }}>$0</span>
                          </div>

                        </div>
                      </>
                    )}
                  </div>
                )}
                {activeTab === "recover" && <RecoverManager />}
              </div>

              {/* RIGHT: Live Market Price Chart (Desktop dual-panel only) */}
              {(activeTab === "bridge" || activeTab === "recover") && (
                <div className="hidden min-[1150px]:flex w-full flex-1 min-w-0 flex-col pt-1">
                  <TokenPriceChart key={bridgeFromAsset || "USDC"} asset={(bridgeFromAsset as any) || "USDC"} height={465} />
                </div>
              )}
            </div>
          )}

          {/* ── HISTORY TAB ── sibling to dual-panel-wrapper, inside main-content column */}
          {activeTab === "history" && (() => {
            // Group current page items (<= 10 items) by day
            const grouped: Record<string, TxHistoryEntry[]> = {};
            historyItems.forEach(item => {
              const day = new Date(item.timestamp).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "short", day: "numeric" });
              if (!grouped[day]) grouped[day] = [];
              grouped[day].push(item);
            });
            const days = Object.keys(grouped);

            const typeLabel = (type: string) =>
              type === "bridge_cctp" ? "CCTP BRIDGE" : "BRIDGE";

            const formatHistoryAmount = (amtStr?: string) => {
              if (!amtStr) return "0.00";
              const num = parseFloat(amtStr);
              if (isNaN(num)) return amtStr;
              if (num === 0) return "0.00";
              if (num >= 0.01) {
                return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              }
              return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
            };

            const statusStyle = (status: string) => ({
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
              padding: "4px 10px",
              borderRadius: 9999,
              color: status === "success" ? "#16a34a" : status === "failed" ? "#dc2626" : "var(--text-primary)",
              background: status === "success" ? "rgba(22,163,74,0.10)" : status === "failed" ? "rgba(220,38,38,0.10)" : "var(--surface-hover, rgba(120, 120, 128, 0.12))",
              border: status === "success" || status === "failed" ? "none" : "1px solid var(--border)",
              whiteSpace: "nowrap" as const,
              flexShrink: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            });

            const isClaimableBridge = (item: TxHistoryEntry) => {
              if (item.type !== "bridge_cctp") return false;
              if (item.status === "success" || !!item.mintHash) return false;

              const burn = (item.burnHash || item.txHash || "").trim();
              const hasBurn = burn !== "" && !burn.startsWith("fail_");
              if (!hasBurn) return false;

              const reason = (item.failureReason || "").toUpperCase();
              if (
                reason.includes("BEFORE_BURN") ||
                reason.includes("BURN_REVERTED") ||
                reason.includes("USER_CANCELLED_BEFORE") ||
                reason.includes("APPROVE_FAILED") ||
                reason.includes("INSUFFICIENT_FUNDS")
              ) {
                return false;
              }

              return item.status === "pending" || (item.status as any) === "claiming" || item.status === "failed";
            };


            return (
              <div className="w-full flex flex-col items-center pb-12 gap-5 -mt-2">
                {/* Centered Filter Bar (All / Success / Pending / Failed) */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    background: isDark ? "#151922" : "var(--surface-soft, #f1f5f9)",
                    padding: 3,
                    borderRadius: 9999,
                    border: isDark ? "1px solid rgba(255, 255, 255, 0.08)" : "1px solid var(--border, #e2e8f0)",
                    gap: 2,
                    width: "fit-content",
                    boxShadow: isDark ? "none" : "0 1px 2px rgba(0,0,0,0.02)",
                  }}
                >
                  {(["all", "success", "pending", "failed"] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => { setHistoryFilter(f); setCursorStack([null]); }}
                      style={{
                        padding: "7px 20px",
                        minWidth: 78,
                        borderRadius: 9999,
                        fontSize: 13,
                        fontWeight: historyFilter === f ? 700 : 500,
                        background: historyFilter === f
                          ? (isDark ? "#283040" : "#ffffff")
                          : "transparent",
                        color: historyFilter === f
                          ? (isDark ? "#ffffff" : "#0f172a")
                          : (isDark ? "#94a3b8" : "#64748b"),
                        border: historyFilter === f
                          ? (isDark ? "1px solid rgba(255, 255, 255, 0.12)" : "1px solid rgba(0, 0, 0, 0.08)")
                          : "1px solid transparent",
                        boxShadow: historyFilter === f
                          ? (isDark ? "none" : "0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)")
                          : "none",
                        cursor: "pointer",
                        transition: "all 0.2s ease",
                        textTransform: "capitalize",
                        fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                        letterSpacing: "-0.015em",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                      }}
                    >
                      {f}
                      {f === "pending" && hasPendingBridge && (
                        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", backgroundColor: "#ef4444", transform: "translateY(-0.5px)" }} />
                      )}
                    </button>
                  ))}
                </div>

                <div className="history-container w-full max-w-[860px] flex flex-col gap-7">
                  {isHistoryLoading && historyItems.length === 0 ? (
                    <div className="flex flex-col gap-4 w-full animate-pulse" style={{ marginTop: 4 }}>
                      {/* Day header skeleton */}
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                        <div style={{ height: 12, width: 130, borderRadius: 6, background: "var(--border, #cbd5e1)" }} />
                        <div style={{ flex: 1, height: 1, background: "var(--border-soft)", opacity: 0.8 }} />
                        <div style={{ height: 12, width: 100, borderRadius: 6, background: "var(--border, #cbd5e1)" }} />
                      </div>

                      {/* Skeleton transaction cards matching real history cards */}
                      {[1, 2, 3].map((idx) => (
                        <div
                          key={idx}
                          style={{
                            background: "var(--surface)",
                            borderRadius: 22,
                            border: "1px solid var(--border)",
                            padding: "18px 22px",
                            display: "flex",
                            flexDirection: "column",
                            gap: 14,
                            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.03)",
                          }}
                        >
                          {/* Top row */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                              {/* Token icon skeleton */}
                              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--border, #94a3b8)", flexShrink: 0, opacity: 0.7 }} />
                              <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1 }}>
                                <div style={{ height: 11, width: 80, borderRadius: 4, background: "var(--border, #cbd5e1)" }} />
                                <div style={{ height: 18, width: 120, borderRadius: 6, background: "var(--border, #94a3b8)", opacity: 0.8 }} />
                              </div>
                            </div>
                            {/* Status badge skeleton */}
                            <div style={{ height: 26, width: 95, borderRadius: 9999, background: "var(--border, #cbd5e1)", flexShrink: 0 }} />
                          </div>

                          {/* Bottom row */}
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                              <div style={{ height: 11, width: 70, borderRadius: 4, background: "var(--border, #cbd5e1)", opacity: 0.7 }} />
                              <div style={{ height: 12, width: 100, borderRadius: 4, background: "var(--border, #cbd5e1)", opacity: 0.8 }} />
                            </div>
                            {/* Details button skeleton */}
                            <div style={{ height: 30, width: 76, borderRadius: 12, background: "var(--border, #cbd5e1)" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : historyItems.length === 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #8E8E93)", fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em", textTransform: "uppercase" }}>History</span>
                        <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
                        <div className="flex gap-2 items-center pl-2">
                          {historyUpdateMsg && (
                            <span style={{ fontSize: 11, color: historyUpdateMsg === "History updated" ? "#16a34a" : "var(--text-muted)", fontWeight: 600, fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>
                              {historyUpdateMsg}
                            </span>
                          )}
                          {lastUpdated && <span style={{ fontSize: 11, color: "var(--text-secondary, #8E8E93)", fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>Last updated: {lastUpdated.toLocaleTimeString()}</span>}
                          <button onClick={handleHistoryRefresh} disabled={isRefreshing || isHistoryLoading}
                            style={{ width: 28, height: 28, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: (isRefreshing || isHistoryLoading) ? "not-allowed" : "pointer", color: "var(--text-muted)", flexShrink: 0 }}>
                            <RefreshCw size={12} style={{ animation: (isRefreshing || isHistoryLoading) ? "spin 1s linear infinite" : "none" }} />
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: "60px 20px", color: "var(--text-muted)" }}>
                        <div style={{ width: 52, height: 52, borderRadius: "50%", background: "var(--bg-default)", border: "1px solid var(--border-soft)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.015em" }}>No on-chain transactions found</div>
                        <div style={{ fontSize: 12.5, color: "var(--text-secondary, #8E8E93)", opacity: 0.8, fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>Your bridge history will appear here</div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {days.map((day, idx) => (
                        <div key={day} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                          {/* Day header */}
                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary, #8E8E93)", fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em", textTransform: "uppercase", whiteSpace: "nowrap" }}>{day}</span>
                            <div style={{ flex: 1, height: 1, background: "var(--border-soft)" }} />
                            {idx === 0 && (
                              <div className="flex gap-2 items-center pl-2">
                                {historyUpdateMsg && (
                                  <span style={{ fontSize: 11, color: historyUpdateMsg === "History updated" ? "#16a34a" : "var(--text-muted)", fontWeight: 600, fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>
                                    {historyUpdateMsg}
                                  </span>
                                )}
                                {lastUpdated && <span style={{ fontSize: 11, color: "var(--text-secondary, #8E8E93)", fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>Last updated: {lastUpdated.toLocaleTimeString()}</span>}
                                <button onClick={handleHistoryRefresh} disabled={isRefreshing || isHistoryLoading}
                                  style={{ width: 28, height: 28, borderRadius: 8, background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: (isRefreshing || isHistoryLoading) ? "not-allowed" : "pointer", color: "var(--text-muted)", flexShrink: 0 }}>
                                  <RefreshCw size={12} style={{ animation: (isRefreshing || isHistoryLoading) ? "spin 1s linear infinite" : "none" }} />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Cards */}
                          {grouped[day].map(item => {
                            const isExpanded = expandedHistoryIds.has(item.id);
                            return (
                              <div key={item.id} style={{
                                background: "var(--surface-soft, rgba(255, 255, 255, 0.03))",
                                borderRadius: 22,
                                border: "1px solid var(--border)",
                                padding: "18px 22px",
                                display: "flex",
                                flexDirection: "column",
                                gap: 14,
                                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.02), inset 0 1px 0 rgba(255, 255, 255, 0.04)",
                                transition: "all 0.2s ease",
                              }}>
                                {/* Top row */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, minWidth: 0 }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0, flex: 1 }}>
                                    {/* Token Icon */}
                                    <img
                                      src={TOKEN_LOGOS[item.fromAsset as Asset] ?? TOKEN_LOGOS[item.toAsset as Asset] ?? "/usdc.png"}
                                      alt={item.fromAsset || "token"}
                                      style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                                      onError={e => { e.currentTarget.src = "/usdc.png"; }}
                                    />
                                    <div style={{ minWidth: 0, flex: 1 }}>
                                      <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary, #8E8E93)", fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>{typeLabel(item.type)}</div>
                                      <div
                                        className="history-item-amount-title"
                                        style={{
                                          fontSize: 18,
                                          fontWeight: 700,
                                          color: "var(--text-primary)",
                                          lineHeight: 1.15,
                                          fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                                          letterSpacing: "-0.02em",
                                          fontVariantNumeric: "tabular-nums",
                                          whiteSpace: "nowrap",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                        }}
                                      >
                                        {formatHistoryAmount(item.amount)} {item.fromAsset || item.toAsset || "USDC"}{item.toAsset && item.fromAsset && item.toAsset !== item.fromAsset ? ` → ${item.toAsset}` : ""}
                                      </div>
                                    </div>
                                  </div>
                                  {isClaimableBridge(item) ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (!item.destChain || !item.toAsset) return;
                                        const payload = {
                                          burnHash: item.burnHash || item.txHash,
                                          burnTxHash: item.burnHash || item.txHash,
                                          sourceChain: item.sourceChain,
                                          destChain: item.destChain,
                                          amount: item.amount,
                                          fromAsset: item.fromAsset,
                                          toAsset: item.toAsset
                                        };
                                        (process.env.NODE_ENV === "development" ? console.log : () => { })("[History -> Top Button Claim] initiating manual claim:", payload);
                                        txEngine.executeManualClaim(payload);
                                        setActiveTab("bridge");
                                        setTimeout(() => {
                                          if (txTrackerRef.current) {
                                            const el = document.querySelector(".right-panel-card") || document.querySelector(".tx-tracker-container");
                                            el?.scrollIntoView({ behavior: "smooth", block: "center" });
                                          }
                                        }, 150);
                                      }}
                                      style={{
                                        fontSize: 11.5,
                                        fontWeight: 600,
                                        letterSpacing: "-0.01em",
                                        fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                                        padding: "5px 13px",
                                        borderRadius: 9999,
                                        color: "var(--text-primary)",
                                        background: "var(--surface-hover, rgba(120, 120, 128, 0.12))",
                                        border: "1px solid var(--border)",
                                        cursor: "pointer",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        whiteSpace: "nowrap",
                                        flexShrink: 0,
                                        lineHeight: 1,
                                        transition: "all 0.15s ease",
                                      }}
                                      className="history-status-badge hover:opacity-80 active:scale-95"
                                    >
                                      Claim Pending
                                    </button>
                                  ) : (
                                    <span className="history-status-badge" style={statusStyle(item.status)}>{item.status.toUpperCase()}</span>
                                  )}
                                </div>

                                {/* Bottom row */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                                    <span style={{ fontSize: 12.5, color: "var(--text-secondary, #8E8E93)", fontWeight: 400, fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>
                                      {new Date(item.timestamp).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                    </span>
                                    {item.destChain ? (
                                      <>
                                        <span className="history-chain-route-desktop" style={{ fontSize: 12.5, color: "var(--text-secondary, #8E8E93)", fontWeight: 400, fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>
                                          {item.sourceChain} → {item.destChain}
                                        </span>
                                        <span className="history-chain-route-mobile" style={{ fontSize: 12.5, color: "var(--text-secondary, #8E8E93)", fontWeight: 400, fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>
                                          <img
                                            src={CHAIN_LOGOS[item.sourceChain as Chain] || "/globe.svg"}
                                            alt={item.sourceChain}
                                            style={{ width: 14, height: 14, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                                            onError={(e) => { e.currentTarget.src = "/globe.svg"; }}
                                          />
                                          <span style={{ fontSize: 11, margin: "0 1px", color: "var(--text-muted)" }}>→</span>
                                          <img
                                            src={CHAIN_LOGOS[item.destChain as Chain] || "/globe.svg"}
                                            alt={item.destChain}
                                            style={{ width: 14, height: 14, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
                                            onError={(e) => { e.currentTarget.src = "/globe.svg"; }}
                                          />
                                        </span>
                                      </>
                                    ) : (
                                      <span style={{ fontSize: 12.5, color: "var(--text-secondary, #8E8E93)", fontWeight: 400, fontFamily: "var(--font-geist), var(--font-inter), sans-serif", letterSpacing: "-0.01em" }}>{item.sourceChain}</span>
                                    )}

                                  </div>
                                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <button
                                      onClick={() => toggleHistoryExpand(item.id)}
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 4,
                                        padding: "6px 14px",
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: isExpanded ? "var(--text-primary)" : "var(--text-secondary, #8E8E93)",
                                        background: isExpanded ? "var(--bg-default)" : "var(--surface-soft, rgba(255,255,255,0.05))",
                                        border: "1px solid var(--border)",
                                        borderRadius: 12,
                                        cursor: "pointer",
                                        transition: "all 0.15s ease",
                                        fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                                        letterSpacing: "-0.01em",
                                      }}
                                    >
                                      <span>Details</span>
                                      {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                    </button>
                                  </div>
                                </div>

                                {/* Expanded Details */}
                                {isExpanded && (
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4, paddingTop: 16, borderTop: "1px dashed var(--border-soft)" }}>
                                    {(item.burnHash || item.txHash) && (() => {
                                      const burnTx = item.burnHash || item.txHash;
                                      const burnUrl = item.sourceChain && burnTx ? ChainRegistry.getExplorerTxUrl(item.sourceChain, burnTx) : null;
                                      return (
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-default)", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--border-soft)" }}>
                                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{item.burnHash ? "Burn Tx" : "Deposit Tx"}</span>
                                            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)" }}>{burnTx?.slice(0, 16)}…{burnTx?.slice(-12)}</span>
                                          </div>
                                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                            {burnUrl && (
                                              <a
                                                href={burnUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", cursor: "pointer" }}
                                              >
                                                <ExternalLink size={11} /> Explorer
                                              </a>
                                            )}
                                            <button
                                              onClick={async () => { try { await navigator.clipboard.writeText(burnTx!); } catch { } }}
                                              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}
                                            >
                                              <Copy size={11} /> Copy
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    {item.mintHash && (() => {
                                      const mintUrl = item.destChain && item.mintHash && item.mintHash !== "ALREADY_CLAIMED_ON_CHAIN" ? ChainRegistry.getExplorerTxUrl(item.destChain, item.mintHash) : null;
                                      return (
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--bg-default)", padding: "10px 14px", borderRadius: 12, border: "1px solid var(--border-soft)" }}>
                                          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: "#059669", textTransform: "uppercase", letterSpacing: "0.05em" }}>Mint Tx</span>
                                            <span style={{ fontSize: 12, fontFamily: "monospace", color: "var(--text-primary)" }}>{item.mintHash.slice(0, 16)}…{item.mintHash.slice(-12)}</span>
                                          </div>
                                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                                            {mintUrl && (
                                              <a
                                                href={mintUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "#059669", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, textDecoration: "none", cursor: "pointer" }}
                                              >
                                                <ExternalLink size={11} /> Explorer
                                              </a>
                                            )}
                                            <button
                                              onClick={async () => { try { await navigator.clipboard.writeText(item.mintHash as string); } catch { } }}
                                              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, cursor: "pointer" }}
                                            >
                                              <Copy size={11} /> Copy
                                            </button>
                                          </div>
                                        </div>
                                      );
                                    })()}

                                    {item.failureReason && (
                                      <div style={{ display: "flex", flexDirection: "column", gap: 4, background: "rgba(220,38,38,0.06)", padding: "10px 14px", borderRadius: 12, border: "1px solid rgba(220,38,38,0.15)" }}>
                                        <span style={{ fontSize: 10, fontWeight: 800, color: "#dc2626", textTransform: "uppercase", letterSpacing: "0.05em" }}>Failure Reason</span>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{item.failureReason}</span>
                                      </div>
                                    )}

                                    {isClaimableBridge(item) && (
                                      <button
                                        onClick={() => {
                                          if (!item.destChain || !item.toAsset) return;
                                          const payload = {
                                            burnHash: item.burnHash || item.txHash,
                                            burnTxHash: item.burnHash || item.txHash,
                                            sourceChain: item.sourceChain,
                                            destChain: item.destChain,
                                            amount: item.amount,
                                            fromAsset: item.fromAsset,
                                            toAsset: item.toAsset
                                          };
                                          (process.env.NODE_ENV === "development" ? console.log : () => { })("[Path B: History Tab -> Resume / Retry Mint] initiating manual claim:", payload);
                                          txEngine.executeManualClaim(payload);
                                          // Switch back to bridge tab to show the tracker
                                          setActiveTab("bridge");
                                        }}
                                        style={{
                                          marginTop: 4, width: "100%", background: "transparent", color: "var(--text-primary)",
                                          border: "1px solid var(--border)", borderRadius: 8, padding: "10px", fontSize: 12, fontWeight: 700,
                                          cursor: "pointer", transition: "all 0.2s"
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = "var(--surface)"}
                                        onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                                      >
                                        Resume / Retry Mint
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ))}

                      {/* True Server-Side Pagination Controls (Shown ONLY when not loading) */}
                      {(cursorStack.length > 1 || historyHasMore) && (
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 mt-2 border-t border-[var(--border-soft)] w-full text-xs" style={{ fontFamily: "var(--font-geist), var(--font-inter), sans-serif" }}>
                          <div className="text-[var(--text-secondary,#8E8E93)] font-normal">
                            Page <span className="font-semibold text-[var(--text-primary)]">{currentPageNumber}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              disabled={currentPageNumber === 1 || isHistoryLoading}
                              onClick={() => {
                                if (currentPageNumber > 1) {
                                  setCursorStack(prev => prev.slice(0, -1));
                                }
                              }}
                              style={{
                                padding: "7px 16px",
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: 600,
                                background: "var(--surface-soft, rgba(255,255,255,0.05))",
                                border: "1px solid var(--border)",
                                color: currentPageNumber === 1 ? "var(--text-muted)" : "var(--text-primary)",
                                cursor: currentPageNumber === 1 ? "not-allowed" : "pointer",
                                opacity: currentPageNumber === 1 ? 0.4 : 1,
                                transition: "all 0.15s ease",
                                fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                              }}
                            >
                              Previous
                            </button>

                            <div
                              style={{
                                minWidth: 32,
                                height: 32,
                                padding: "0 10px",
                                borderRadius: 12,
                                fontSize: 12.5,
                                fontWeight: 700,
                                background: isDark ? "#283040" : "var(--surface)",
                                color: "var(--text-primary)",
                                border: "1px solid var(--border)",
                                boxShadow: isDark ? "none" : "0 1px 2px rgba(0, 0, 0, 0.04)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                                fontVariantNumeric: "tabular-nums",
                              }}
                            >
                              {currentPageNumber}
                            </div>

                            <button
                              disabled={!historyHasMore || isHistoryLoading}
                              onClick={() => {
                                if (historyNextCursor) {
                                  setCursorStack(prev => [...prev, historyNextCursor]);
                                }
                              }}
                              style={{
                                padding: "7px 16px",
                                borderRadius: 12,
                                fontSize: 12,
                                fontWeight: 600,
                                background: "var(--surface-soft, rgba(255,255,255,0.05))",
                                border: "1px solid var(--border)",
                                color: !historyHasMore ? "var(--text-muted)" : "var(--text-primary)",
                                cursor: !historyHasMore ? "not-allowed" : "pointer",
                                opacity: !historyHasMore ? 0.4 : 1,
                                transition: "all 0.15s ease",
                                fontFamily: "var(--font-geist), var(--font-inter), sans-serif",
                              }}
                            >
                              Next
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })()}




        </div> {/* end main content */}


      </div>
    </>
  );
}

function StellarTrustlineAction({ stellarWallet, onVerify }: { stellarWallet: any, onVerify: () => Promise<void> }) {
  const [isSigning, setIsSigning] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [success, setSuccess] = React.useState(false);

  const getFriendlyError = (code: string) => {
    if (code.includes("ERR_STELLAR_ACCOUNT_NOT_FOUND")) return "Destination Stellar account does not exist.";
    if (code.includes("ERR_STELLAR_INSUFFICIENT_XLM")) return "Insufficient XLM to establish a trustline. Minimum 1.5 XLM required.";
    if (code.includes("ERR_STELLAR_UNAUTHORIZED_TRUSTLINE")) return "Wallet is not authorized to hold this asset.";
    if (code.includes("ERR_STELLAR_MISSING_TRUSTLINE")) return "Destination wallet is missing a USDC trustline.";
    if (code.includes("ERR_TRANSACTION_EXPIRED")) return "Transaction expired. Please approve faster in Freighter.";
    if (code.includes("ERR_USER_REJECTED")) return "Transaction rejected by user.";
    if (code.includes("ERR_TRANSACTION_FAILED")) return "Transaction failed on the Stellar network.";
    if (code.includes("ERR_NETWORK_UNAVAILABLE")) return "Unable to connect to the Stellar network.";
    return code;
  };

  const handleAdd = async () => {
    try {
      setIsSigning(true);
      setErr("");

      const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
      let accountRes;
      try {
        accountRes = await horizon.loadAccount(stellarWallet.address);
      } catch (e: any) {
        if (e?.response?.status === 404) {
          throw new Error("ERR_STELLAR_ACCOUNT_NOT_FOUND");
        }
        throw e;
      }

      const nativeAsset = accountRes.balances.find(b => b.asset_type === "native");
      const nativeBalance = nativeAsset ? Number(nativeAsset.balance) : 0;
      const sellingLiabilities = nativeAsset && "selling_liabilities" in nativeAsset ? Number(nativeAsset.selling_liabilities || 0) : 0;

      const requiredReserve = (2 + (accountRes.subentry_count || 0) + 1) * 0.5;

      if ((nativeBalance - sellingLiabilities) < requiredReserve) {
        setErr("ERR_STELLAR_INSUFFICIENT_XLM");
        setIsSigning(false);
        return;
      }

      const usdcIssuer = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
      const usdcAsset = new StellarAsset("USDC", usdcIssuer);

      const feeStats = await horizon.feeStats();
      const recommendedFee = feeStats?.fee_charged?.p90 || "10000";

      const sourceAccount = new Account(stellarWallet.address, accountRes.sequence);
      const tx = new TransactionBuilder(sourceAccount, {
        fee: String(recommendedFee),
        networkPassphrase: Networks.TESTNET,
      })
        .addOperation(Operation.changeTrust({ asset: usdcAsset }))
        .setTimeout(300)
        .build();

      const xdr = tx.toXDR();
      const signedXdr = await stellarWallet.signTransaction(xdr);

      if (!signedXdr) {
        setErr("ERR_USER_REJECTED");
        setIsSigning(false);
        return;
      }

      const signedTx = TransactionBuilder.fromXDR(signedXdr, Networks.TESTNET);
      const result = await horizon.submitTransaction(signedTx);

      if (result.successful) {
        setSuccess(true);
        setTimeout(() => {
          onVerify();
        }, 3000);
      }
    } catch (e: any) {
      console.error(e);
      let errMsg = "ERR_TRANSACTION_FAILED";
      if (e?.response?.data?.extras?.result_codes) {
        const codes = e.response.data.extras.result_codes;
        if (codes.transaction === "tx_too_late") {
          errMsg = "ERR_TRANSACTION_EXPIRED";
        } else if (codes.operations && codes.operations.includes("op_no_trust")) {
          errMsg = "ERR_STELLAR_MISSING_TRUSTLINE";
        } else if (codes.operations && codes.operations.includes("op_not_authorized")) {
          errMsg = "ERR_STELLAR_UNAUTHORIZED_TRUSTLINE";
        } else if (codes.operations && codes.operations.includes("op_no_account")) {
          errMsg = "ERR_STELLAR_ACCOUNT_NOT_FOUND";
        }
      }
      setErr(errMsg);
    } finally {
      setIsSigning(false);
    }
  };

  return (
    <div style={{ padding: "16px", background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.15)", borderRadius: 12, marginBottom: 16 }}>
      <h4 style={{ margin: "0 0 8px 0", color: "#dc2626", fontSize: 14 }}>USDC Trustline Missing</h4>
      <p style={{ margin: "0 0 16px 0", fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        Authorize wallet to receive bridged USDC.
      </p>

      {err && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 12, fontWeight: 500 }}>{getFriendlyError(err)}</div>}
      {success && <div style={{ color: "#10b981", fontSize: 12, marginBottom: 12, fontWeight: 600 }}>✓ Trustline added! Verifying...</div>}

      {!success && (
        <button
          onClick={handleAdd}
          disabled={isSigning}
          className="cyber-button swap-action-btn"
          style={{ width: "100%", padding: "10px", minHeight: 40, fontSize: 13 }}
        >
          {isSigning ? "Signing..." : "Add USDC Trustline"}
        </button>
      )}
    </div>
  );
}
