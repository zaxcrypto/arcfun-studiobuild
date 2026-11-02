# Circle CCTP & Arc App Kit Integration Research

**Document Version:** 1.0.0  
**Date:** October 31, 2026  
**Target Environment:** ArcFun Multi-Chain Engine (Testnet & Mainnet)

---

## 1. Executive Summary

This document presents a comprehensive technical research report and architectural blueprint for integrating Circle's official SDKs—specifically **Bridge Kit (`@circle-fin/bridge-kit`)**, the umbrella **Arc App Kit (`@circle-fin/app-kit`)**, and the **Viem v2 adapter (`@circle-fin/adapter-viem-v2`)**—into ArcFun. 

The primary objective is to systematically expand ArcFun from its current multi-testnet architecture into a secure, production-grade Mainnet bridge ecosystem across all eligible networks, while strictly preserving and honoring the verified working Arc Mainnet ↔ Base Mainnet CCTP V2 custom backend/adapter.

---

## 2. Product Investigation: App Kit vs Bridge Kit

Through direct inspection of Circle's official npm package registry (as of October 2026), we investigated `@circle-fin/app-kit` (v1.20.0) and `@circle-fin/bridge-kit` (v1.17.0).

### Key Findings:
1. **Relationship**:
   - `@circle-fin/app-kit` is an **umbrella developer SDK** that bundles multiple modular kits: `@circle-fin/bridge-kit` (v1.17.0), `@circle-fin/earn-kit`, `@circle-fin/swap-kit`, `@circle-fin/borrow-kit`, `@circle-fin/onramp-kit`, and `@circle-fin/unified-balance-kit`.
   - `@circle-fin/bridge-kit` is the **core, dedicated engine for CCTP and CCTP V2 USDC bridging**.
2. **Adapter Architecture**:
   - Both packages utilize `@circle-fin/adapter-viem-v2` (v1.20.0) for EVM blockchain interactions.
   - The adapter natively wraps Viem (`^2.30.0`), aligning perfectly with ArcFun's `viem: ^2.53.1`.
3. **Recommendation for ArcFun**:
   - Utilize `@circle-fin/bridge-kit` and `@circle-fin/adapter-viem-v2` directly for bridging logic to maintain a lightweight bundle and eliminate unnecessary financial module dependencies.
   - Maintain the standard CCTP V2 contracts and fallback mechanism for Arc Mainnet (Domain 26).

---

## 3. Existing ArcFun Testnet Chains Audit

Below is the inventory of all chains currently configured in ArcFun (`src/config/extra-chains.ts`, `swap-contract.ts`, and `src/lib/bridge/cctp-provider.ts`):

| Chain Name | Network | Chain ID | CCTP Domain | Existing Bridge Support | CCTP V2 Available | Circle Bridge Kit Support | Mainnet Available | Integration Method |
|---|---|---|---|---|---|---|---|---|
| **Arc Testnet** | Testnet | 5042002 / 1516 | 26 | Yes | Yes | Yes (`ArcTestnet`) | Yes (Arc Mainnet 5042) | Native / Custom Viem |
| **Ethereum Sepolia** | Testnet | 11155111 | 0 | Yes | Yes | Yes (`EthereumSepolia`) | Yes (Ethereum 1) | Native Bridge Kit / Viem |
| **Arbitrum Sepolia** | Testnet | 421614 | 3 | Yes | Yes | Yes (`ArbitrumSepolia`) | Yes (Arbitrum One 42161) | Native Bridge Kit / Viem |
| **Base Sepolia** | Testnet | 84532 | 6 | Yes | Yes | Yes (`BaseSepolia`) | Yes (Base 8453) | Native Bridge Kit / Viem |
| **Optimism Sepolia** | Testnet | 11155420 | 2 | Yes | Yes | Yes (`OptimismSepolia`) | Yes (OP Mainnet 10) | Native Bridge Kit / Viem |
| **Polygon Amoy** | Testnet | 80002 | 7 | Yes | Yes | Yes (`PolygonAmoy`) | Yes (Polygon 137) | Native Bridge Kit / Viem |
| **Avalanche Fuji** | Testnet | 43113 | 1 | Yes | Yes | Yes (`AvalancheFuji`) | Yes (Avalanche C-Chain 43114) | Native Bridge Kit / Viem |
| **Solana Devnet** | Testnet | 0 | 5 | Partial | Yes | Yes (`SolanaDevnet`) | Yes (Solana Mainnet) | Specialized Solana Adapter |
| **Sonic Testnet** | Testnet | 14601 | 13 | Yes | Yes | Yes (`SonicTestnet`) | Yes (Sonic 146) | Native Bridge Kit / Viem |
| **Ink Sepolia** | Testnet | 763373 | 21 | Yes | Yes | Yes (`InkTestnet`) | Yes (Ink 57073) | Native Bridge Kit / Viem |
| **Monad Testnet** | Testnet | 10143 | 15 | Yes | Yes | Yes (`MonadTestnet`) | Yes (Monad 143) | Native Bridge Kit / Viem |
| **Unichain Sepolia** | Testnet | 1301 | 10 | Yes | Yes | Yes (`UnichainSepolia`) | Yes (Unichain 130) | Native Bridge Kit / Viem |
| **Linea Sepolia** | Testnet | 59141 | 11 | Yes | Yes | Yes (`LineaSepolia`) | Yes (Linea 59144) | Native Bridge Kit / Viem |
| **HyperEVM Testnet**| Testnet | 998 | 19 | Yes | Yes | Yes (`HyperEVMTestnet`) | Yes (HyperEVM 999) | Native Bridge Kit / Viem |
| **Stellar Testnet** | Testnet | N/A | 27 | Partial | Custom | No | Roadmap | Custom Soroban Relayer |
| **Sui Testnet** | Testnet | N/A | 8 | Partial | Custom | No | Roadmap | Custom Move Adapter |

---

## 4. Circle CCTP V2 Architecture & Universal Contracts

In CCTP V2, Circle introduced unified contract deployments across EVM chains alongside backward-compatible V1 contracts.

### Universal V2 EVM Contract Addresses
- **TokenMessenger (V2)**: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`
- **TokenMessengerWithFees (V2 Fast Transfer)**: `0x71f54F818671cD0D7ea140Da213e5C8b5C92a408`
- **MessageTransmitter (V2)**: `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`

### Key Differences: CCTP V1 vs V2
1. **Nonce Verification (`usedNonces`)**:
   - In V1, nonces are hashed with the source domain: `keccak256(abi.encodePacked(sourceDomain, nonce))`.
   - In V2, nonces are indexed directly as a 32-byte word (`bytes32 rawNonce`) on `MessageTransmitterV2`.
2. **Fast Transfers & Custom Fees**:
   - V2 introduces `depositForBurnWithFee` on `TokenMessengerWithFees`, enabling attestation arrival within seconds instead of waiting 15–20 minutes for L1/L2 block finality.
3. **Split Architecture**:
   - Token burning and message transmission are decoupled, allowing granular relayer execution and individual manual claims.

---

## 5. Eligible Mainnet Chain Registry & Configurations

The following chains are officially verified in Circle Bridge Kit (`@circle-fin/bridge-kit/chains`) for Mainnet CCTP V2:

| Chain Name | Chain ID | CCTP Domain | Native USDC Address | CCTP TokenMessenger (V2) | Explorer Base URL |
|---|---|---|---|---|---|
| **Arc Mainnet** | 5042 | 26 | `0x3600000000000000000000000000000000000000` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://explorer.arc.io/tx/{hash}` |
| **Base Mainnet** | 8453 | 6 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://basescan.org/tx/{hash}` |
| **Ethereum Mainnet** | 1 | 0 | `0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://etherscan.io/tx/{hash}` |
| **Arbitrum One** | 42161 | 3 | `0xaf88d065e77c8cc2239327c5edb3a432268e5831` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://arbiscan.io/tx/{hash}` |
| **OP Mainnet** | 10 | 2 | `0x0b2c639c533813f4aa9d7837caf62653d097ff85` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://optimistic.etherscan.io/tx/{hash}` |
| **Polygon PoS** | 137 | 7 | `0x3c499c542cef5e3811e1192ce70d8cc03d5c3359` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://polygonscan.com/tx/{hash}` |
| **Avalanche C-Chain**| 43114 | 1 | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://snowtrace.io/tx/{hash}` |
| **Sonic Mainnet** | 146 | 13 | `0x29219dd400f2Bf60E5a23d13Be72B486D4038894` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://sonicscan.org/tx/{hash}` |
| **Ink Mainnet** | 57073 | 21 | `0x2D270e6886d130D724215A266106e6832161EAEd` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://explorer.inkonchain.com/tx/{hash}` |
| **Unichain Mainnet**| 130 | 10 | `0x078D782b760474a361dDA0AF3839290b0EF57AD6` | `0x4e744b28E787c3aD0e810eD65A24461D4ac5a762` | `https://uniscan.xyz/tx/{hash}` |
| **Linea Mainnet** | 59144 | 11 | `0x176211869ca2b568f2a7d4ee941e073a821ee1ff` | `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` | `https://lineascan.build/tx/{hash}` |

---

## 6. Architecture & Integration Plan

```
┌─────────────────────────────────────────────────────────────┐
│                       ArcFun Bridge UI                      │
│      (Dynamic Selector: Testnet vs Mainnet Mode Isolation)  │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
     [Standard EVM Chains]          [Custom / Arc Mainnet Route]
               │                              │
               ▼                              ▼
┌─────────────────────────────┐ ┌─────────────────────────────┐
│  Circle Bridge Kit Engine   │ │ Existing Arc Mainnet Client │
│   (@circle-fin/bridge-kit)  │ │   (cctp-mainnet-client.ts)  │
│  with Viem v2 Adapter       │ │   Verified & Preserved!     │
└──────────────┬──────────────┘ └─────────────┬───────────────┘
               │                              │
               └──────────────┬───────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Universal Bridge API Relayer                 │
│         (/api/bridge/claim, /api/bridge/history)            │
│  - Dual-mode nonce check (V1 keccak256 vs V2 raw bytes32)   │
│  - Dynamic Gas Price Monitoring via Chainlink / Alchemy     │
│  - Manual Wallet Claim Fallback                             │
└─────────────────────────────────────────────────────────────┘
```

### Safety & Isolation Guarantees
1. **Network Mode Enforcement**:
   - `NEXT_PUBLIC_NETWORK_MODE` and the `/api/network/mode` gatekeeper prevent unauthorized access to Mainnet routes.
   - Admin-only preview ensures no public traffic reaches mainnet contracts until formally approved.
2. **Preservation of Arc ↔ Base Route**:
   - The verified custom implementation in `cctp-mainnet-client.ts` remains the primary handler for Arc Mainnet (Domain 26).
   - Other EVM routes interface seamlessly through Circle Bridge Kit.
3. **Database & Schema Protection**:
   - Zero SQL migrations executed during expansion.
   - Isolation between testnet transactions and mainnet transactions via network mode metadata tags.

