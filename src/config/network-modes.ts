/**
 * Network Modes Configuration
 * Single source of truth for Testnet and Mainnet chain definitions,
 * feature flags, and validation rules.
 *
 * Rules:
 *  - Mainnet is DISABLED by default (ARCFUN_MAINNET_ENABLED !== "true").
 *  - Arc Testnet (5042002) is the primary default network.
 *  - Arc Mainnet (5042) is the primary mainnet network.
 *  - Circle Gateway, Faucet, Chat Pay, and Autopay are strictly Testnet-only.
 */

import {
  sepolia, arbitrumSepolia, baseSepolia, lineaSepolia, optimismSepolia, avalancheFuji,
  base, arbitrum, mainnet, optimism, polygon, avalanche, sonic, ink, unichain, linea
} from "viem/chains";
import { arcTestnet } from "./arc-chain";
import {
  arcMainnet, sonicTestnet, monadTestnet, unichainSepolia, inkSepolia,
  injectiveTestnet, hyperEVMTestnet, giwaSepolia, polygonAmoy, xLayerTestnet,
} from "./extra-chains";

export type NetworkMode = "testnet" | "mainnet";

export const MODE_STORAGE_KEY = "arcfun-env";

/** EVM chain ids supported in Mainnet mode. */
export const MAINNET_EVM_CHAIN_IDS: readonly number[] = [
  arcMainnet.id, base.id, arbitrum.id, mainnet.id, optimism.id,
  polygon.id, avalanche.id, sonic.id, ink.id, unichain.id, linea.id
];

/** EVM chain ids supported in Testnet mode. */
export const TESTNET_EVM_CHAIN_IDS: readonly number[] = [
  arcTestnet.id, sepolia.id, arbitrumSepolia.id, baseSepolia.id, lineaSepolia.id,
  optimismSepolia.id, avalancheFuji.id, sonicTestnet.id, monadTestnet.id,
  unichainSepolia.id, inkSepolia.id, injectiveTestnet.id, hyperEVMTestnet.id,
  giwaSepolia.id, polygonAmoy.id, xLayerTestnet.id,
];

/** Bridge (CCTP) routes available on Mainnet. */
export const MAINNET_BRIDGE_CHAINS = [
  "Arc Mainnet", "Base Mainnet", "Arbitrum Mainnet", "Ethereum Mainnet",
  "OP Mainnet", "Polygon Mainnet", "Avalanche Mainnet", "Sonic Mainnet",
  "Ink Mainnet", "Unichain Mainnet", "Linea Mainnet"
] as const;

/** Features enabled by mode. Anything false is blocked and hidden. */
export const MODE_FEATURES = {
  testnet: {
    bridge: true,
    gateway: true,
    chatPay: true,
    autopay: true,
    swap: true,
    recovery: true,
    history: true,
    faucet: true,
  },
  mainnet: {
    bridge: true,
    gateway: false,
    chatPay: false,
    autopay: false,
    swap: false,
    recovery: false,
    history: true,
    faucet: false,
  },
} as const;

const CHAIN_NAMES: Record<number, string> = {
  [arcMainnet.id]: "Arc Mainnet",
  [base.id]: "Base",
  [arbitrum.id]: "Arbitrum One",
  [arcTestnet.id]: "Arc Testnet",
  [sepolia.id]: "Ethereum Sepolia",
  [arbitrumSepolia.id]: "Arbitrum Sepolia",
  [baseSepolia.id]: "Base Sepolia",
};

export function chainDisplayName(chainId?: number): string {
  if (!chainId) return "an unknown network";
  return CHAIN_NAMES[chainId] || `chain ${chainId}`;
}

export function modeOfChainId(chainId?: number): NetworkMode | "unknown" {
  if (chainId === undefined) return "unknown";
  if (MAINNET_EVM_CHAIN_IDS.includes(chainId)) return "mainnet";
  if (TESTNET_EVM_CHAIN_IDS.includes(chainId)) return "testnet";
  return "unknown";
}

export function isChainAllowedInMode(chainId: number, mode: NetworkMode): boolean {
  return modeOfChainId(chainId) === mode;
}

export function isMainnetFeatureEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED === "true" ||
    process.env.ARCFUN_MAINNET_ENABLED === "true"
  );
}

export function resolveInitialMode(sessionValue?: string | null): NetworkMode {
  if (!isMainnetFeatureEnabled()) return "testnet";
  return sessionValue === "mainnet" ? "mainnet" : "testnet";
}

export function validateBridgeForMode(
  mode: NetworkMode,
  sourceChain: string,
  destChain: string,
  fromAsset?: string,
  toAsset?: string
): string | null {
  const isMainnetName = (n: string) => (MAINNET_BRIDGE_CHAINS as readonly string[]).includes(n);

  if (mode === "mainnet") {
    if (!isMainnetFeatureEnabled()) {
      return "Mainnet is currently disabled.";
    }
    if (!isMainnetName(sourceChain) || !isMainnetName(destChain)) {
      return "This bridge route is only available on Testnet.";
    }
    if ((fromAsset && fromAsset !== "USDC") || (toAsset && toAsset !== "USDC")) {
      return "Only USDC can be bridged on Mainnet.";
    }
    return null;
  }

  if (isMainnetName(sourceChain) || isMainnetName(destChain) || /mainnet/i.test(`${sourceChain} ${destChain}`)) {
    return "This is a Mainnet route. Switch ArcFun to Mainnet to use it.";
  }
  return null;
}

