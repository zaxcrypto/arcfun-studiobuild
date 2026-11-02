# Circle CCTP Mainnet Verification & Official Parameter Registry

**Date:** 2026-10-31  
**Status:** Officially Supported & Verified  
**Scope:** Arc Mainnet (Domain `26`) ↔ Base Mainnet (Domain `6`)

---

## 1. Executive Verification Summary

Circle Cross-Chain Transfer Protocol (CCTP) V2 officially supports both **Arc Mainnet** and **Base Mainnet**. Direct cross-chain burn and mint operations between Arc Mainnet and Base Mainnet are supported using CCTP V2 contracts and standard 32-byte address representations.

- **Arc Mainnet Supported:** YES. Designated CCTP Domain ID is **`26`**.
- **Base Mainnet Supported:** YES. Designated CCTP Domain ID is **`6`**.
- **Direct Arc ↔ Base Routing:** Supported natively by CCTP V2.
- **USDC Address on Arc Mainnet:** `0x3600000000000000000000000000000000000000` (Native pre-compiled ERC-20 interface, 6 decimals).
- **USDC Address on Base Mainnet:** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Native USDC issued by Circle, 6 decimals).

---

## 2. Verified Contract Addresses & Domain Registry

### A. Arc Mainnet (Domain `26`, Chain ID `5042`)
*Source: Circle CCTP Supported Chains & Arc Protocol Documentation*
- **Domain ID:** `26`
- **Chain ID:** `5042`
- **USDC Contract:** `0x3600000000000000000000000000000000000000`
- **TokenMessengerV2:** `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`
- **MessageTransmitterV2:** `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`
- **Native Gas Currency:** ETH (18 decimals) / Precompile Gas
- **RPC Endpoint:** `https://rpc.mainnet.arc.io` (fallback) / `process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL`
- **Block Explorer:** `https://arc-mainnet.cloud.blockscout.com`

### B. Base Mainnet (Domain `6`, Chain ID `8453`)
*Source: Circle Official EVM Deployment Registry*
- **Domain ID:** `6`
- **Chain ID:** `8453`
- **USDC Contract (Native):** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **TokenMessengerV2:** `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d`
- **TokenMessengerV1 (Legacy):** `0x1682Ae6375C4E4A97e4B583BC394c861A46D8962`
- **MessageTransmitterV2:** `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64`
- **MessageTransmitterV1 (Legacy):** `0xAD09780d193884d503182aD4588450C416D6F9D4`
- **Native Gas Currency:** ETH (18 decimals)
- **RPC Endpoint:** `https://mainnet.base.org` / `process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL`
- **Block Explorer:** `https://basescan.org`

---

## 3. Circle Attestation API Specifications

### CCTP V2 Attestation Service
- **Base Host (Mainnet):** `https://iris-api.circle.com`
- **Endpoint Structure:**
  ```http
  GET https://iris-api.circle.com/v2/messages/{sourceDomainId}?transactionHash={sourceTxHash}
  ```
  *(For Arc Mainnet source transfers, `sourceDomainId = 26`)*
- **Response Format:**
  Returns an object containing the status (`complete` or `pending_confirmations`), `messages[0].message` (hex-encoded raw cross-chain message), and `messages[0].attestation` (65-byte cryptographic signature from Circle attestation keys).

---

## 4. Transfer Procedure & Parameters (Arc Mainnet → Base Mainnet)

### Step 1: ERC-20 Approval on Arc
- Contract: `0x3600000000000000000000000000000000000000` (Arc USDC)
- Spender: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` (TokenMessengerV2)
- Amount: `1,000,000` (1 USDC, 6 decimals)

### Step 2: Deposit For Burn on Arc
- Contract: `0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d` (TokenMessengerV2)
- Function:
  ```solidity
  depositForBurn(
    uint256 amount,                  // 1000000
    uint32 destinationDomain,        // 6 (Base)
    bytes32 mintRecipient,           // padded 32-byte address of recipient
    address burnToken                // 0x3600000000000000000000000000000000000000
  )
  ```

### Step 3: Attestation Polling
- Poll `https://iris-api.circle.com/v2/messages/26?transactionHash={burnTxHash}` until status is `complete`.

### Step 4: Receive Message on Base
- Contract: `0x81D40F21F12A8F0E3252Bccb954D722d4c464B64` (MessageTransmitterV2 on Base)
- Function:
  ```solidity
  receiveMessage(
    bytes message,                   // raw message from Iris API
    bytes attestation                // attestation signature from Iris API
  )
  ```
- Result: Mints 1 USDC directly to the recipient wallet on Base.

