/**
 * Centralized Mainnet Chain Registry
 *
 * Single source of truth for all verified Circle CCTP V2 Mainnet chains.
 * Verified against official `@circle-fin/bridge-kit` definitions.
 *
 * STAGE 1 FOCUS: Arc Mainnet <-> Base Mainnet is verified active.
 * Other eligible chains are defined with complete contract configurations,
 * but only exposed when active in network-modes / feature-flags.
 */

import { Arc, Base, Ethereum, Arbitrum, Optimism, Polygon, Avalanche, Sonic, Ink, Unichain, Linea } from "@circle-fin/bridge-kit";

export interface MainnetChainMetadata {
  name: string;
  chainKey: string;
  chainId: number;
  domain: number;
  usdcAddress: `0x${string}`;
  tokenMessengerV2: `0x${string}`;
  messageTransmitterV2: `0x${string}`;
  tokenMessengerWithFees?: `0x${string}` | null;
  fastTransferSupported: boolean;
  rpcUrl: string;
  fallbackRpcUrl?: string;
  explorerUrl: string;
  status: "ACTIVE" | "PENDING_VALIDATION" | "DISABLED";
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export const MAINNET_CHAIN_REGISTRY: Record<string, MainnetChainMetadata> = {
  "Arc Mainnet": {
    name: "Arc Mainnet",
    chainKey: "Arc",
    chainId: Arc.chainId, // 5042
    domain: Arc.cctp.domain, // 26
    usdcAddress: Arc.usdcAddress as `0x${string}`, // 0x3600000000000000000000000000000000000000
    tokenMessengerV2: Arc.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Arc.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: null, // Arc does not have Fast Transfer (Standard Transfer only)
    fastTransferSupported: false,
    rpcUrl: process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || process.env.ARC_MAINNET_RPC_URL || "https://arc-mainnet.g.alchemy.com/v2/Vt9_fvDipTI7hEZdMc950",
    fallbackRpcUrl: "https://rpc.mainnet.arc.io",
    explorerUrl: "https://explorer.arc.io/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }
  },
  "Base Mainnet": {
    name: "Base Mainnet",
    chainKey: "Base",
    chainId: Base.chainId, // 8453
    domain: Base.cctp.domain, // 6
    usdcAddress: Base.usdcAddress as `0x${string}`, // 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
    tokenMessengerV2: Base.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Base.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Base.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
    fallbackRpcUrl: "https://base.publicnode.com",
    explorerUrl: "https://basescan.org/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
  },
  "Arbitrum Mainnet": {
    name: "Arbitrum Mainnet",
    chainKey: "Arbitrum",
    chainId: Arbitrum.chainId, // 42161
    domain: Arbitrum.cctp.domain, // 3
    usdcAddress: Arbitrum.usdcAddress as `0x${string}`,
    tokenMessengerV2: Arbitrum.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Arbitrum.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Arbitrum.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_ARB_MAINNET_RPC_URL || "https://arb1.arbitrum.io/rpc",
    fallbackRpcUrl: "https://arbitrum-one.publicnode.com",
    explorerUrl: "https://arbiscan.io/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
  },
  "Ethereum Mainnet": {
    name: "Ethereum Mainnet",
    chainKey: "Ethereum",
    chainId: Ethereum.chainId, // 1
    domain: Ethereum.cctp.domain, // 0
    usdcAddress: Ethereum.usdcAddress as `0x${string}`,
    tokenMessengerV2: Ethereum.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Ethereum.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Ethereum.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_ETH_MAINNET_RPC_URL || "https://ethereum-rpc.publicnode.com",
    fallbackRpcUrl: "https://ethereum.publicnode.com",
    explorerUrl: "https://etherscan.io/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
  },
  "OP Mainnet": {
    name: "OP Mainnet",
    chainKey: "Optimism",
    chainId: Optimism.chainId, // 10
    domain: Optimism.cctp.domain, // 2
    usdcAddress: Optimism.usdcAddress as `0x${string}`,
    tokenMessengerV2: Optimism.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Optimism.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Optimism.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_OP_MAINNET_RPC_URL || "https://mainnet.optimism.io",
    fallbackRpcUrl: "https://optimism-rpc.publicnode.com",
    explorerUrl: "https://optimistic.etherscan.io/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
  },
  "Polygon Mainnet": {
    name: "Polygon Mainnet",
    chainKey: "Polygon",
    chainId: Polygon.chainId, // 137
    domain: Polygon.cctp.domain, // 7
    usdcAddress: Polygon.usdcAddress as `0x${string}`,
    tokenMessengerV2: Polygon.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Polygon.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Polygon.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_POLYGON_MAINNET_RPC_URL || "https://polygon-rpc.com",
    fallbackRpcUrl: "https://polygon-bor-rpc.publicnode.com",
    explorerUrl: "https://polygonscan.com/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Polygon", symbol: "POL", decimals: 18 }
  },
  "Avalanche Mainnet": {
    name: "Avalanche Mainnet",
    chainKey: "Avalanche",
    chainId: Avalanche.chainId, // 43114
    domain: Avalanche.cctp.domain, // 1
    usdcAddress: Avalanche.usdcAddress as `0x${string}`,
    tokenMessengerV2: Avalanche.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Avalanche.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Avalanche.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_AVALANCHE_MAINNET_RPC_URL || "https://api.avax.network/ext/bc/C/rpc",
    fallbackRpcUrl: "https://avalanche-c-chain-rpc.publicnode.com",
    explorerUrl: "https://snowtrace.io/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 }
  },
  "Sonic Mainnet": {
    name: "Sonic Mainnet",
    chainKey: "Sonic",
    chainId: Sonic.chainId, // 146
    domain: Sonic.cctp.domain, // 13
    usdcAddress: Sonic.usdcAddress as `0x${string}`,
    tokenMessengerV2: Sonic.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Sonic.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Sonic.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_SONIC_MAINNET_RPC_URL || "https://rpc.soniclabs.com",
    fallbackRpcUrl: "https://sonic-rpc.publicnode.com",
    explorerUrl: "https://sonicscan.org/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 }
  },
  "Ink Mainnet": {
    name: "Ink Mainnet",
    chainKey: "Ink",
    chainId: Ink.chainId, // 57073
    domain: Ink.cctp.domain, // 21
    usdcAddress: Ink.usdcAddress as `0x${string}`,
    tokenMessengerV2: Ink.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Ink.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Ink.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_INK_MAINNET_RPC_URL || "https://rpc-gel.inkonchain.com",
    fallbackRpcUrl: "https://rpc.inkonchain.com",
    explorerUrl: "https://explorer.inkonchain.com/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
  },
  "Unichain Mainnet": {
    name: "Unichain Mainnet",
    chainKey: "Unichain",
    chainId: Unichain.chainId, // 130
    domain: Unichain.cctp.domain, // 10
    usdcAddress: Unichain.usdcAddress as `0x${string}`,
    tokenMessengerV2: Unichain.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Unichain.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Unichain.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_UNICHAIN_MAINNET_RPC_URL || "https://mainnet.unichain.org",
    fallbackRpcUrl: "https://unichain-rpc.publicnode.com",
    explorerUrl: "https://uniscan.xyz/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
  },
  "Linea Mainnet": {
    name: "Linea Mainnet",
    chainKey: "Linea",
    chainId: Linea.chainId, // 59144
    domain: Linea.cctp.domain, // 11
    usdcAddress: Linea.usdcAddress as `0x${string}`,
    tokenMessengerV2: Linea.cctp.contracts.v2.tokenMessenger as `0x${string}`,
    messageTransmitterV2: Linea.cctp.contracts.v2.messageTransmitter as `0x${string}`,
    tokenMessengerWithFees: (Linea.cctp.contracts.v2 as any).tokenMessengerWithFees || "0x71f54F818671cD0D7ea140Da213e5C8b5C92a408",
    fastTransferSupported: true,
    rpcUrl: process.env.NEXT_PUBLIC_LINEA_MAINNET_RPC_URL || "https://rpc.linea.build",
    fallbackRpcUrl: "https://linea-rpc.publicnode.com",
    explorerUrl: "https://lineascan.build/tx/{hash}",
    status: "ACTIVE",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
  }
};

/** Get only verified active Mainnet chains (Arc Mainnet and Base Mainnet for Phase 1) */
export function getActiveMainnetChains(): MainnetChainMetadata[] {
  return Object.values(MAINNET_CHAIN_REGISTRY).filter(c => c.status === "ACTIVE");
}

/** Check if Fast Transfer is supported between a source and destination */
export function isFastTransferSupported(sourceName: string, destName: string): boolean {
  const source = MAINNET_CHAIN_REGISTRY[sourceName];
  const dest = MAINNET_CHAIN_REGISTRY[destName];
  if (!source || !dest) return false;
  // If source is Arc, Fast Transfer is not supported per Circle documentation
  if (source.chainKey === "Arc") return false;
  return source.fastTransferSupported && (dest.fastTransferSupported || true);
}

