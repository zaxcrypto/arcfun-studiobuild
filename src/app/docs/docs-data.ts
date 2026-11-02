export interface DocSection {
  id: string;
  title: string;
  badge?: string;
  category: 'Overview' | 'Circle CCTP Bridge' | 'ArcFun Wallet' | 'Web3 Chat' | 'Circle Gateway' | 'Security & Policies' | 'Support';
  breadcrumbs: string[];
  summary: string;
  content: string; // Markdown / structured content
  subsections?: { id: string; title: string }[];
}

export const DOC_CATEGORIES = [
  'Overview',
  'Circle CCTP Bridge',
  'ArcFun Wallet',
  'Web3 Chat',
  'Circle Gateway',
  'Security & Policies',
  'Support'
] as const;

export const DOC_SECTIONS: DocSection[] = [
  {
    id: 'intro',
    title: 'Introduction to ArcFun',
    category: 'Overview',
    breadcrumbs: ['Overview', 'Get Started', 'Introduction'],
    summary: 'ArcFun is an all-in-one multi-chain Web3 DeFi platform uniting cross-chain bridging, smart wallet custody, and wallet-to-wallet messaging.',
    subsections: [
      { id: 'what-is-arcfun', title: 'What is ArcFun?' },
      { id: 'core-pillars', title: 'Core Platform Pillars' },
      { id: 'problems-solved', title: 'Problems ArcFun Solves' },
      { id: 'supported-ecosystems', title: 'Supported Ecosystems' }
    ],
    content: `
### What is ArcFun?

**ArcFun** (accessible via [thearcfun.xyz](https://thearcfun.xyz)) is an all-in-one decentralized Web3 finance platform and multi-chain execution environment. Built to solve multi-chain fragmentation, ArcFun combines high-speed cross-chain asset bridging and token swaps, a biometric-secured multi-chain native wallet, Circle Gateway unified liquidity, and real-time wallet-to-wallet messaging into a single, cohesive user experience.

With ArcFun, users no longer need to jump across dozens of disjointed decentralized apps, manage multiple browser wallet extensions, or worry about seed phrase vulnerabilities.

---

### Core Platform Pillars

| Pillar | Description |
| :--- | :--- |
| **Circle CCTP Cross-Chain Bridge** | Fast native USDC cross-chain bridging across EVM networks and non-EVM ecosystems (Solana, Sui, Stellar) powered by Circle CCTP V2. |
| **ArcFun Native Wallet** | Hardware-secured multi-chain smart wallet provisioning institutional Circle Developer-Controlled Wallets (DCW) across both EVM (Arc & L2s) and Solana, unified under Touch ID / Face ID biometric passkeys. |
| **Web3 Chat & Social Pay** | Real-time wallet-to-wallet messaging with instant in-chat cryptocurrency transfers, recurring autopay, and direct contact tipping. |
| **Circle Gateway Unified Liquidity** | Institutional-grade unified balance and cross-chain settlement protocol supporting gas-sponsored transfers. |
| **Granular Security Policies** | Enterprise-grade safety engine with user-customizable 24-hour daily transfer caps, max per-transaction limits, and biometric threshold prompts. |
| **Consolidated Portfolio** | Multi-chain balance aggregator providing unified USD portfolio valuation, asset distribution breakdowns, and live oracle pricing. |

---

### Problems ArcFun Solves

1. **Multi-Chain Fragmentation:** Users traditionally juggle separate wallet extensions (e.g. MetaMask for EVM, Phantom for Solana) with separate seed phrases. ArcFun unifies EVM and SVM accounts under one seamless authentication session.
2. **Gas Dependency & Onboarding Hurdles:** Transferring funds on a new network normally requires acquiring that chain's native gas asset first. ArcFun utilizes paymaster gas sponsorship and native USDC gas abstraction.
3. **Catastrophic Wallet Draining:** Standard Web3 wallets allow total account drainage if a private key or session is compromised. ArcFun enforces strict 24-hour velocity limits and per-transaction caps before any transfer is signed.
4. **Complex Address Sharing:** Sending money to friends or contacts requires copying error-prone 44-character strings. ArcFun Web3 Chat allows direct contact-based messaging and one-tap in-chat payments.
`
  },
  {
    id: 'architecture',
    title: 'ArcFun System Architecture',
    category: 'Overview',
    breadcrumbs: ['Overview', 'Architecture', 'System Overview'],
    summary: 'A deep dive into how ArcFun coordinates client presentation, security policy enforcement, Circle DCW custody, and cross-chain relaying.',
    subsections: [
      { id: 'architectural-layers', title: 'Platform Layers' },
      { id: 'transaction-flow', title: 'Transaction Flow' },
      { id: 'failover-reliability', title: 'High Availability & Failovers' }
    ],
    content: `
### Platform Layers

ArcFun is engineered across four decoupled architectural layers to guarantee security, high throughput, and zero single points of failure:

1. **Client & Presentation Layer:**
   - React 19 & Next.js App Router application with responsive state handling.
   - Dual-mode deployment: full-screen Web3 DeFi dashboard and floating embeddable wallet manager widget.
   - Integrated Wagmi connectors (MetaMask, Coinbase Wallet, Rainbow, WalletConnect) and Solana Wallet Adapter, alongside WebAuthn biometric hardware modules.

2. **Policy Engine & Guardrail Layer:**
   - Pre-execution validation pipeline enforcing user-defined safety policies before any transaction can touch blockchain nodes.
   - Evaluates USD valuation against real-time oracle feeds (CoinGecko and DEX quotes).
   - Enforces rolling 24-hour volume caps and rejects transactions that exceed user thresholds.
   - Manages atomic intent locks (\`payment_ledger\`) with expiration timers to eliminate double-spend vectors.

3. **Multi-Chain Execution & Custody Layer:**
   - **Circle DCW Multi-Chain Engine:** Both EVM accounts (Arc Network & Ethereum/L2s) and Solana accounts are provisioned via Circle's institutional Developer-Controlled Wallet (DCW) APIs, with cryptographic key material safeguarded in institutional Hardware Security Modules (HSMs).
   - **Native Gas Sponsorship & RPC Routing:** Built-in paymasters sponsor gas for eligible cross-chain actions and provide high-availability RPC routing across supported chains.

4. **Data Synchronization & Realtime Messaging:**
   - Supabase PostgreSQL with Row-Level Security (RLS) policies.
   - Supabase Realtime websocket channels for instant chat delivery, typing indicators, and presence updates.
   - Background reconciliation continuously updating transaction states and on-chain blockchain hashes.

---

### Transaction Flow

\`\`\`
[User Transfer / Swap Request]
          │
          ▼
[1. Live Oracle Valuation] ─────── (Real-time price feed calculates USD value)
          │
          ▼
[2. Policy Engine Verification] ── (Enforces per-tx max & 24h cumulative volume)
          │
          ├─► [Limit Exceeded] ───► Prompts user with direct link to increase limit
          │
          ▼
[3. Biometric Challenge] ────────► (Triggers Face ID / Touch ID if > threshold)
          │
          ▼
[4. Atomic Intent Reservation] ──► (Locks intent in ledger to prevent double-spend)
          │
          ▼
[5. Blockchain Execution] ───────► (Circle DCW API or EVM Paymaster RPC)
          │
          ▼
[6. Ledger Confirmation] ────────► (Balances refreshed + UI updated instantly)
\`\`\`
`
  },
    {
    id: 'bridge-overview',
    title: 'Circle CCTP Cross-Chain Bridge',
    category: 'Circle CCTP Bridge',
    breadcrumbs: ['Circle CCTP Bridge', 'Cross-Chain', 'Overview'],
    summary: 'Frictionless multi-chain native USDC transfers across EVM and Solana ecosystems powered by Circle CCTP V2.',
    subsections: [
      { id: 'how-bridging-works', title: 'How ArcFun Bridging Works' },
      { id: 'eight-step-lifecycle', title: 'The 8-Step Bridge Lifecycle' },
      { id: 'circle-cctp-routing', title: 'Circle CCTP V2 Architecture' },
      { id: 'burn-mint-safety', title: 'Burn-and-Mint Security & Self-Claim Recovery' }
    ],
    content: `
### How ArcFun Bridging Works

The **ArcFun Circle CCTP Bridge** enables users to transfer native USDC seamlessly across 11 EVM Mainnet networks and Solana Mainnet without wrap/unwrap friction or vulnerable liquidity pools.

Users can bridge across:
- **EVM Mainnet Networks:** Arc Mainnet, Base, Ethereum, Arbitrum One, OP Mainnet, Polygon, Avalanche C-Chain, Sonic, Ink, Unichain, and Linea.
- **Solana Ecosystem:** Solana Mainnet (Domain 5) with dynamic SPL Associated Token Account (ATA) handling.
- **Developer Testnets:** Arc Testnet, Sepolia, and Solana Devnet.

---

### The 8-Step Bridge Lifecycle

Every cross-chain transfer via ArcFun follows a deterministic 8-step protocol:

1. **Pre-Flight Validation & Allowance:** The interface checks wallet balances, destination network status, and queries the user's ERC-20 / SPL allowance. If needed, a single-transaction allowance approval is signed.
2. **On-Chain Burn Execution:** The user initiates the burn. On EVM, this calls \`depositForBurn()\` on the local TokenMessenger; on Solana, it executes \`deposit_for_burn\` against the official Circle CCTP program (\`CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd\`).
3. **Receipt & Nonce Extraction:** The transaction confirms on the source blockchain. ArcFun extracts the emitted \`MessageSent\` event containing the raw payload, nonce, source domain, and destination domain.
4. **Circle Iris Attestation Polling:** ArcFun relays the message hash to Circle's official Iris Attestation API (\`https://iris-api.circle.com/v1/attestations/{messageHash}\`), polling until cryptographic consensus is reached.
5. **Consensus Signature Verification:** Circle's attestation service returns a Schnorr/ECDSA cryptographic signature proving that the native USDC was permanently destroyed on the source network.
6. **Relayer Auto-Claim Dispatch:** The ArcFun backend relayer automatically picks up the attestation and prepares the destination execution payload, paying gas on behalf of the user.
7. **Destination Mint Execution:** The destination TokenMessenger verifies Circle's attestation signature and mints genuine native USDC directly to the recipient address. On Solana, if the recipient USDC ATA does not exist, it is created automatically.
8. **Ledger Reconciliation & UI Update:** The transaction status is updated to \`COMPLETE\` in the ArcFun ledger, and UI balances refresh in real time.

---

### Circle CCTP V2 Architecture

Traditional bridges lock tokens in a smart contract and mint wrapped or synthetic representations on another chain. If the bridge pool is compromised, the wrapped tokens become worthless.

ArcFun uses **Circle CCTP V2**:
- **Zero Slippage:** 1:1 cross-chain capital efficiency with zero slippage or market impact.
- **Genuine Native USDC:** Destination mints real, native USDC minted directly by Circle's contracts.
- **Permissionless Settlement:** Anyone with the valid attestation signature can finalize the mint.

---

### Burn-and-Mint Security & Self-Claim Recovery

ArcFun is non-custodial and resilient against infrastructure disruptions:
- **Relayer Independence:** In the event of backend relayer delays or gas price spikes, users retain 100% control to manually finalize the claim using the built-in **/recover** tool or ArcFun UI claim button.
- **Duplicate Claim Protection:** Circle's smart contracts maintain an immutable nonce bitmap. Any attempt to replay or claim an attestation twice is rejected at the protocol level.
- **Atomic State Guarantee:** Because tokens are burned on the source, your funds cannot be double-spent or lost in transit.
`
  },
  {
    id: 'cctp-multichain-registry',
    title: 'Mainnet CCTP Chain Registry',
    badge: 'Registry',
    category: 'Circle CCTP Bridge',
    breadcrumbs: ['Circle CCTP Bridge', 'Chains', 'Authoritative Registry'],
    summary: 'Complete authoritative directory of supported Mainnet EVM and Solana networks, CCTP domains, and contract addresses.',
    subsections: [
      { id: 'mainnet-registry-table', title: 'Mainnet Network & Contract Directory' },
      { id: 'solana-mainnet-specs', title: 'Solana Mainnet Specifications' },
      { id: 'testnet-registry-table', title: 'Developer Testnet Directory' }
    ],
    content: `
### Mainnet Network & Contract Directory

ArcFun connects to official Circle CCTP V2 deployments across the following production networks:

| Network | Chain ID | CCTP Domain | Native USDC Address | TokenMessenger Contract |
| :--- | :--- | :--- | :--- | :--- |
| **Arc Mainnet** | \`5042\` | \`26\` | \`0x369527A13488ee2E089b2c3c6fD03914a1c5d909\` | \`0xbd3fa81b58ba92d82136038b25adec7066af3155\` |
| **Base** | \`8453\` | \`6\` | \`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\` | \`0x1682Ae6375C4E4A97e4B583BC394c861A46D8962\` |
| **Ethereum** | \`1\` | \`0\` | \`0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48\` | \`0xbd3fa81b58ba92d82136038b25adec7066af3155\` |
| **Arbitrum One** | \`42161\` | \`3\` | \`0xaf88d065e77c8cC2239327C5EDb3A432268e5831\` | \`0x19330d52D9F3F6b1a7d18B8476F8bE51648937eF\` |
| **OP Mainnet** | \`10\` | \`2\` | \`0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85\` | \`0x2B4069517957735bE00ceE0fadAE88a26365528f\` |
| **Polygon PoS** | \`137\` | \`7\` | \`0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359\` | \`0x9daF8c91AEbae50b9c0E6808D41849104f697472\` |
| **Avalanche** | \`43114\` | \`1\` | \`0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E\` | \`0x6B25532e1060CE10cc3B0A99e5683b91BFDe6982\` |
| **Sonic** | \`146\` | \`13\` | \`0x29219dd400f2Bf60E5a23d13Be72B486D4038894\` | \`0x19330d52D9F3F6b1a7d18B8476F8bE51648937eF\` |
| **Ink** | \`57073\` | \`23\` | \`0x29219dd400f2Bf60E5a23d13Be72B486D4038894\` | \`0x19330d52D9F3F6b1a7d18B8476F8bE51648937eF\` |
| **Unichain** | \`130\` | \`24\` | \`0x078D782b760474a361dDA0AF3839290b0EF57AD6\` | \`0x19330d52D9F3F6b1a7d18B8476F8bE51648937eF\` |
| **Linea** | \`59144\` | \`11\` | \`0x176211869cA2b568f2A7D4EE941E073a821EE1ff\` | \`0x19330d52D9F3F6b1a7d18B8476F8bE51648937eF\` |
| **Solana** | Mainnet | \`5\` | \`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\` | \`CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd\` |

---

### Solana Mainnet Specifications

- **TokenMessengerMinterV2 Program:** \`CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe\`
- **MessageTransmitterV2 Program:** \`CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC\`
- **Legacy CCTP V1 Program:** \`CCTPmbSD7gX1bxKPAmg77w8oFzNFpaQiQUWD43TKaecd\`
- **Native USDC Mint:** \`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\`
- **Decimals:** \`6\`
- **CCTP Domain:** \`5\`
- **Token Program:** Official SPL Token Program (\`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA\`)
- **Associated Token Program:** \`ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL\`

---

### Developer Testnet Directory

| Network | Chain ID / Environment | CCTP Domain | USDC Contract |
| :--- | :--- | :--- | :--- |
| **Arc Testnet** | \`5042002\` | \`26\` | \`0x369527A13488ee2E089b2c3c6fD03914a1c5d909\` |
| **Ethereum Sepolia** | \`11155111\` | \`0\` | \`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238\` |
| **Solana Devnet** | Devnet | \`5\` | \`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU\` |
`
  },
  {
    id: 'solana-mainnet-cctp',
    title: 'Solana Mainnet CCTP V2 Architecture',
    badge: 'Solana',
    category: 'Circle CCTP Bridge',
    breadcrumbs: ['Circle CCTP Bridge', 'Solana', 'Architecture'],
    summary: 'Technical architecture for EVM to Solana and Solana to EVM cross-chain transfers using Circle CCTP V2.',
    subsections: [
      { id: 'solana-dual-integration', title: 'Dual Solana Wallet Support' },
      { id: 'ata-derivation-handling', title: 'Dynamic ATA Derivation & Creation' },
      { id: 'solana-relayer-and-recovery', title: 'Relayer Execution & Manual Fallback' },
      { id: 'rpc-resilience', title: 'RPC Failover & Transaction Reliability' }
    ],
    content: `
### Dual Solana Wallet Support

ArcFun supports two independent connection modes for Solana Mainnet:
1. **Self-Custodial Solana Wallets:** Users can connect standard browser wallets (Phantom, Solflare, Backpack) directly via the official Solana Wallet Adapter.
2. **ArcFun Native Smart Wallets:** Users can provision an institutional Solana account managed via Circle Developer-Controlled Wallets (DCW) protected by biometric Passkeys (Face ID / Touch ID).

Both modes interface with the same on-chain Circle CCTP V2 programs and benefit from automated relayer gas coverage.

---

### Dynamic ATA Derivation & Creation

On Solana, tokens cannot be held directly by a system wallet address; they must reside in an **Associated Token Account (ATA)** derived from the owner's public key and the token mint.

ArcFun handles this dynamically:
1. **Mint Resolution:** Detects network mode (Mainnet vs Devnet) and binds to the authoritative USDC Mint (\`EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v\` on Mainnet).
2. **Off-Chain ATA Derivation:** Calculates \`findProgramAddressSync([wallet.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)\`.
3. **Existence Check:** Queries the Solana RPC for account info.
4. **Idempotent Creation:** If the destination ATA does not exist, the bridge instruction or relayer automatically prepends \`createAssociatedTokenAccountInstruction()\` before the mint claim instruction, guaranteeing that the transfer never fails due to a missing token account.

---

### Relayer Execution & Manual Fallback

To provide a zero-friction user experience:
- **Backend Relayer Gas Sponsorship:** ArcFun maintains a dedicated Solana relayer keypair with automated balance checks. The relayer claims the destination mint transaction and pays network execution fees.
- **Fail-Safe Manual Claim:** If the relayer is temporarily low on SOL, rate-limited by RPCs, or network congestion causes a timeout, the user is never stuck. The ArcFun UI immediately exposes a **Claim Manually** button, allowing the user to sign and complete the destination claim directly from their own connected wallet.
- **Dedicated Recovery Engine:** The **/recover** page allows pasting any historical bridge transaction hash to retrieve its Circle attestation and execute the destination mint on demand.

---

### RPC Failover & Transaction Reliability

Solana RPC endpoints frequently experience traffic throttling during high network activity. ArcFun employs an active failover cluster:
- **Primary Mainnet RPC:** High-performance dedicated RPC.
- **Fallback Mainnet RPC:** Secondary failover node automatically engaged if the primary returns HTTP 429, 503, or slot lag.
- **Preflight Commitment:** Bridges query \`confirmed\` status for immediate user feedback and require \`finalized\` status for attestation emission, ensuring transaction finality.
`
  },
  {
    id: 'wallet-overview',
    title: 'ArcFun Native Smart Wallet',
    category: 'ArcFun Wallet',
    breadcrumbs: ['ArcFun Wallet', 'Smart Wallet', 'Overview'],
    summary: 'A non-custodial multi-chain wallet with biometric passkeys, dual-engine account architecture, and seed-phrase elimination.',
    subsections: [
      { id: 'dual-chain-architecture', title: 'Dual-Engine Model' },
      { id: 'webauthn-security', title: 'Biometrics & Passkeys' },
      { id: 'portfolio-aggregation', title: 'Consolidated Portfolio' }
    ],
    content: `
### Dual-Engine Model

Most Web3 wallets force users to manage separate 12-word seed phrases, install conflicting browser extensions, and disconnect when switching between EVM and Solana. ArcFun eliminates these barriers through a **Unified Dual-Engine Architecture**:

- **EVM Account (Arc Network & L2s):** Provisioned on-demand via Circle's institutional Developer-Controlled Wallet (DCW) APIs directly on Arc Network and EVM chains.
- **Solana Account (SVM):** Simultaneously provisioned on-demand within the same unified wallet set via Circle's institutional Developer-Controlled Wallet (DCW) APIs.

Both accounts are created in a single step and secured by your device's biometric passkeys (Touch ID, Face ID, or Windows Hello). When you sign in, ArcFun automatically hydrates both addresses and displays your balances in a single consolidated portfolio—eliminating seed phrases, browser extensions, and manual network switching.

*(Note: Users who prefer using traditional external browser extensions like MetaMask or Phantom can still connect them separately through the external wallet connection option).*

---

### Biometrics & Passkeys (WebAuthn)

ArcFun replaces vulnerable 12-word paper seed phrases with **hardware-backed biometric passkeys**:
- **Touch ID, Face ID & Windows Hello:** Cryptographic key pairs generated inside your device's Secure Enclave / TPM chip via WebAuthn standards.
- **Phishing Resistant:** WebAuthn credentials cannot be harvested by fraudulent copycat websites.
- **Fallback Password Protection:** Users configure a secondary security password for devices without biometric hardware or browser compatibility.

---

### Consolidated Portfolio

Every asset in your ArcFun Wallet displays:
1. **Total Holdings:** Consolidated aggregate balance across all supported networks.
2. **Chain Breakdown:** Expanding an asset displays exact balances per blockchain with dedicated Send and Receive buttons.
3. **Real-Time Fiat Valuation:** Asset values refresh every 30 seconds using live market oracle feeds.
`
  },
  {
    id: 'web3-chat',
    title: 'Web3 Chat & Social Payments',
    category: 'Web3 Chat',
    breadcrumbs: ['Web3 Chat', 'Social Pay', 'Overview'],
    summary: 'Real-time wallet-to-wallet messaging with instant in-chat cryptocurrency tipping and recurring payments.',
    subsections: [
      { id: 'wallet-messaging', title: 'Wallet-to-Wallet Messaging' },
      { id: 'social-payments', title: 'In-Chat Payments & Autopay' },
      { id: 'contacts-and-management', title: 'Contacts & Conversation Management' }
    ],
    content: `
### Wallet-to-Wallet Messaging

**ArcFun Web3 Chat** brings communication directly into your decentralized wallet:
- **Direct Address Messaging:** Initiate direct chats with any recipient simply by entering their wallet address.
- **Real-Time Delivery:** Messages and typing indicators synchronize instantly using Supabase Realtime websocket channels.
- **Wallet-Authenticated Identity:** Users authenticate using their wallet session (Sign-In with Ethereum).

---

### In-Chat Payments & Autopay

Sending crypto to peers no longer requires asking for their address, copying it to clipboard, and worrying about address poisoning:
1. Open any active chat conversation.
2. Click the **Send Payment** action button inside the chat interface.
3. Choose the token and amount (e.g. 10 USDC or 0.1 SOL).
4. The payment is executed on-chain and verified directly within the conversation thread with a live transaction explorer link.
5. **Autopay Rules:** Configure recurring daily, weekly, or monthly payments directly between trusted contacts.

---

### Contacts & Conversation Management

- **Contact Book:** Save frequently accessed wallet addresses with custom nicknames.
- **Thread Controls:** Pin your most important conversations, archive finished threads, or hide unwanted chats.
- **Rich Media & Reactions:** React to messages with emojis, reply to specific messages, and share media attachments.
`
  },
  {
    id: 'circle-gateway',
    title: 'Circle Gateway & Liquidity',
    category: 'Circle Gateway',
    breadcrumbs: ['Circle Gateway', 'Protocol', 'Overview'],
    summary: 'Cross-chain unified liquidity protocol enabling instant gasless transfers and institutional settlement.',
    subsections: [
      { id: 'gateway-mechanics', title: 'Unified Liquidity Mechanics' },
      { id: 'sponsored-attestation', title: 'Gasless Transfers & Sponsorship' },
      { id: 'supported-tokens', title: 'Supported Gateway Assets' }
    ],
    content: `
### Unified Liquidity Mechanics

**ArcFun Circle Gateway** enables instant cross-chain liquidity settlement without liquidity fragmentation:
- Coordinates balance transfers across supported networks via institutional Circle APIs.
- Eliminates traditional 7-day optimistic rollup bridge withdrawal delays.
- Provides atomic execution guarantees backed by verifiable cryptographic attestations.

---

### Gasless Transfers & Sponsorship

On eligible transactions, ArcFun's **Fee Sponsorship Engine** sponsors destination execution fees:
- Users pay fees natively in stablecoins (USDC/EURC) rather than requiring native gas tokens (ETH/SOL).
- ArcFun's fee treasury automatically attests and relays the transaction to destination validators.
`
  },
    {
    id: 'anti-phishing-and-trust',
    title: 'Trust, Safety & Anti-Phishing Guide',
    badge: 'Trust & Safety',
    category: 'Security & Policies',
    breadcrumbs: ['Security & Policies', 'Trust & Safety', 'Verification Guide'],
    summary: 'Authoritative guide to verifying official ArcFun domains, wallet security guidelines, and reporting security concerns.',
    subsections: [
      { id: 'official-domains-and-handles', title: 'Official ArcFun Domains & Channels' },
      { id: 'wallet-extension-security-notes', title: 'Wallet Extension Security & Warnings' },
      { id: 'best-practices-self-custody', title: 'Self-Custody Best Practices' },
      { id: 'security-contact', title: 'Vulnerability Disclosure & Contact' }
    ],
    content: `
### Official ArcFun Domains & Channels

To protect yourself against phishing and impersonation, bookmark and verify our official channels:

| Asset | Official Identifier | Verification |
| :--- | :--- | :--- |
| **Primary Domain** | \`https://www.thearcfun.xyz\` | Official Production Website |
| **Apex Domain** | \`https://thearcfun.xyz\` | 301 Redirect to Primary |
| **Official Documentation** | \`https://www.thearcfun.xyz/docs\` | Comprehensive Knowledgebase |
| **Official GitHub** | \`https://github.com/zaxcrypto/Arc.fun\` | Open-Source Code Repository |
| **Official Public Build** | \`https://github.com/zaxcrypto/arcfun-studiobuild\` | Public UI & Build Repository |
| **Official X (Twitter)** | \`@ArcFunTerminal\` | Official Announcements & Community |
| **Official Security Email** | \`supportarcfun@gmail.com\` | Security Inquiries & Appeals |

> [!WARNING]
> Never connect your wallet to any unofficial mirror, copycat domain, or link shared in unverified Telegram direct messages. ArcFun staff will never DM you first.

---

### Wallet Extension Security & Warnings

Some modern Web3 wallet extensions (such as Phantom or browser security plugins powered by Blowfish or ScamSniffer) employ aggressive heuristic filters for newly registered domains (.xyz TLDs) or Web3 applications requesting CCTP token allowances before an official directory listing is indexed.

If you encounter a security warning in Phantom:
- **Heuristic Nature:** Scanners flag unfamiliar domains until manual security verification is completed. ArcFun is an open-source, non-custodial interface with zero drainer scripts, zero tracking pixels, and verified smart contracts.
- **Audit Verification:** Review our complete open-source codebase on GitHub and verify contract addresses against official Circle CCTP documentation.
- **Safe Navigation:** If you have verified the URL (\`https://www.thearcfun.xyz\`), you can safely click proceed or connect using alternative non-custodial wallets (Rabby, MetaMask, Solflare, Coinbase Wallet).

---

### Self-Custody Best Practices

1. **Verify Token Approvals:** When bridging, inspect the allowance contract. It should strictly match the official Circle TokenMessenger address for your chain.
2. **Review Spending Caps:** ArcFun configures exact transaction allowances rather than infinite approvals wherever possible.
3. **Use Hardware & Passkeys:** Enable biometric Passkeys in ArcFun Native Wallet to ensure every high-value transfer requires local physical authorization (Touch ID / Face ID).
4. **Never Export Seed Phrases:** ArcFun will never ask for your recovery phrase, password, or private key.

---

### Vulnerability Disclosure & Contact

ArcFun is committed to platform integrity and responsible disclosure:
- If you discover a security vulnerability or anomalous transaction behavior, contact our security team immediately at **[supportarcfun@gmail.com](mailto:supportarcfun@gmail.com)**.
- For legitimate false-positive domain unblocking inquiries with security providers (Blowfish, Phantom, ScamSniffer), our team maintains active developer verification tickets.
`
  },
  {
    id: 'security-policies',
    title: 'Security Architecture & Guardrails',
    category: 'Security & Policies',
    breadcrumbs: ['Security & Policies', 'Protection', 'Policy Engine'],
    summary: 'Granular user-configured policies, daily limits, velocity controls, and anti-drain safeguards.',
    subsections: [
      { id: 'policy-parameters', title: 'Configurable Policy Parameters' },
      { id: 'daily-limits-logic', title: 'Rolling 24-Hour Limits' },
      { id: 'increasing-limits', title: 'How to Increase Limits' }
    ],
    content: `
### Configurable Policy Parameters

ArcFun implements an active security policy engine (\`src/lib/security/policy-engine.ts\`) safeguarding every connected wallet:

| Policy Setting | Default | Description |
| :--- | :--- | :--- |
| **Max Per Transaction** | \`$500.00 USD\` | Rejects any single transfer whose calculated USD valuation exceeds this limit. |
| **Daily Transfer Limit** | \`$1,000.00 USD\` | Rejects transfers if cumulative outgoing transfers within the last 24 hours exceed this cap. |
| **Passkey Threshold** | \`$100.00 USD\` | Transfers exceeding this value require Face ID / Touch ID biometric authentication. |
| **Velocity Cap** | Active | Prevents rapid consecutive transfers within seconds to stop automated drainer scripts. |

---

### Rolling 24-Hour Limits

Rather than resetting at midnight UTC, ArcFun calculates transfer volume across a true rolling 24-hour window:
\`\`\`typescript
// Rolling 24-hour daily limit enforcement
const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
const { data: pastTxs } = await supabaseAdmin
  .from('payment_ledger')
  .select('amount, token, status')
  .eq('user_id', user.id)
  .gte('created_at', oneDayAgo)
  .in('status', ['RESERVED', 'SUBMITTING', 'PENDING', 'CONFIRMED', 'COMPLETE']);
\`\`\`

If a proposed transfer would push the 24-hour total above your configured daily cap, the transaction is safely rejected before any signatures are created.

---

### How to Increase Limits

If you need to make a larger transfer:
1. Open **ArcFun Wallet** and tap **Settings** (or click the alert banner in the transfer screen).
2. Navigate to **Security Center**.
3. Adjust your **Per-Transaction Limit** or **Daily Transfer Cap**.
4. Confirm the modification with your biometric passkey or master password.
`
  },
  {
    id: 'support',
    title: 'Help & Official Support',
    badge: 'Helpdesk',
    category: 'Support',
    breadcrumbs: ['Support', 'Helpdesk & Community'],
    summary: 'Reach out to the ArcFun engineering and operations team for direct technical support, wallet connection assistance, or community discussions.',
    subsections: [
      { id: 'wallet-troubleshooting', title: 'Wallet Connection Troubleshooting' },
      { id: 'security-advisory', title: 'Official Security Advisory' },
      { id: 'response-times', title: 'Response Times & SLAs' }
    ],
    content: `
### Wallet Connection Troubleshooting

If you are having trouble connecting or verifying your wallet in the ArcFun Native Wallet modal, follow these diagnostic steps:

1. **Verify Browser Extension State:**
   - Make sure your wallet extension (MetaMask, Phantom, Rabby, Coinbase Wallet) is unlocked and on the latest version.
   - If multiple wallet extensions conflict (e.g. Phantom and MetaMask intercepting \`window.ethereum\`), try temporarily disabling unused extensions or opening the app in an Incognito window.
2. **Network & Chain Selection:**
   - ArcFun connects to supported EVM chains (Arbitrum, Base, Optimism, Ethereum, Polygon) and Solana.
   - If prompted by your wallet to switch chains, accept the network switch request.
3. **Biometric & Passkey Prompt:**
   - ArcFun Native Smart Wallets utilize hardware-backed WebAuthn (Touch ID / Face ID / Windows Hello) for transaction authorization.
   - Ensure your browser permits WebAuthn credentials and biometric prompts.
4. **RPC & Firewall Diagnostics:**
   - If connection timeouts occur, check whether aggressive ad-blockers, VPN firewalls, or privacy extensions are blocking WebSocket or RPC calls to \`thearcfun.xyz\` and Circle APIs.

---

### Official Security Advisory

> [!NOTE]
> ArcFun team members will **NEVER** direct message you first asking for seed phrases, private keys, passwords, or recovery codes. Always verify official domains: thearcfun.xyz and www.thearcfun.xyz.

- **Never share private keys:** Legitimate support never requires your secret recovery phrase.
- **Check URLs carefully:** Always verify you are on https://thearcfun.xyz or https://www.thearcfun.xyz before approving signatures.
- **Report imposters:** If you encounter phishing attempts or fake accounts on Telegram or X, immediately report them to [supportarcfun@gmail.com](mailto:supportarcfun@gmail.com).

---

### Response Times & SLAs

- **Telegram Community:** Typical response within **5 to 30 minutes** during active hours.
- **Email Support:** Inquiries answered within **12 to 24 hours** by our technical team.
- **Critical Security Inquiries:** Handled with expedited priority via [supportarcfun@gmail.com](mailto:supportarcfun@gmail.com).
`
  }
];
