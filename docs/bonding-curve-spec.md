# ArcFun Bonding Curve Financial & Mathematical Specification (Stage 2)

## 1. System Overview & Architecture

ArcFun is a fair-launch token launchpad on EVM networks (initial deployment: Ethereum Sepolia Testnet, `chainId: 11155111`), pairing newly deployed meme tokens against verified Dinari Tokenized Stocks (default: `NVDA` dShare `0x4B47153A241b9d22ae37c2aAEe7A6519fF2Dbfc6`).

This document defines the rigorous mathematical specification, parameterization, reserve invariants, rounding rules, and safety boundaries for the **Core Bonding Curve Financial Engine**.

```
                           ┌───────────────────────────┐
                           │    ArcFunCurveFactory     │
                           └─────────────┬─────────────┘
                                         │ deploys atomically
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
    ┌────────────────────────┐                      ┌────────────────────────┐
    │     ArcFunMemeToken    │                      │   ArcFunBondingCurve   │
    │  (ERC-20, 1B Supply)   │◄─── 100% Minted ─────┤ (Virtual Reserves AMM) │
    └────────────────────────┘                      └────────────┬───────────┘
                                                                 │
                                         ┌───────────────────────┴───────────────────────┐
                                         ▼ (Active Phase)                                ▼ (Graduation Phase)
                            ┌────────────────────────┐                      ┌────────────────────────┐
                            │    buy() / sell()      │                      │     state=GRADUATED    │
                            │  (Meme <-> NVDA Stock) │                      │   (DEX Seeding Ready)  │
                            └────────────────────────┘                      └────────────────────────┘
```

---

## 2. Supply Allocation & Initial Parameters

| Parameter | Symbol | Value | Units / Scale | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Total Meme Token Supply** | $T_{\text{total}}$ | $1,000,000,000$ | $10^9 \times 10^{18}$ base units | Standard 1B token supply for meme tokens. |
| **Curve Sale Inventory** | $T_{\text{sale}}$ | $800,000,000$ | $8 \times 10^8 \times 10^{18}$ (80%) | 80% available for fair-launch bonding curve trading. |
| **DEX Liquidity Allocation** | $T_{\text{dex}}$ | $200,000,000$ | $2 \times 10^8 \times 10^{18}$ (20%) | 20% reserved for Uniswap V2 liquidity pool at graduation. |
| **Creator Free Allocation** | $T_{\text{creator}}$ | $0$ | $0$ (0%) | 0% free tokens. True fair launch prevents instant creator dumping. |
| **Graduation Real Quote Target** | $R_{\text{target}}$ | $41.6$ | $41.6 \times 10^{18}$ base units | Selected graduation target in `NVDA` dShares. |
| **Virtual Quote Reserve** | $R_v$ | $10.4$ | $10.4 \times 10^{18}$ base units | Calibrated to $R_v = \frac{1}{4} R_{\text{target}}$ for smooth $25\times$ price discovery. |
| **Virtual Token Reserve** | $T_v$ | $1,000,000,000$ | $10^9 \times 10^{18}$ base units | Derived from invariant matching $T_{\text{sale}}$ graduation condition. |
| **Constant Product Invariant** | $k$ | $1.04 \times 10^{46}$ | $(R_v \times T_v)$ | $10.4 \times 10^{18} \times 10^{27} = 1.04 \times 10^{46}$. |

---

## 3. Mathematical Derivation of Virtual Reserves

The constant-product virtual reserve invariant is defined as:
$$ (R_v + r) \times (T_v - t) = k = R_v \times T_v $$

Where:
- $r$ is the real quote deposited into the curve ($0 \le r \le R_{\text{target}}$).
- $t$ is the cumulative meme tokens sold to buyers ($0 \le t \le T_{\text{sale}}$).
- $R_v$ is the phantom/virtual quote reserve.
- $T_v$ is the phantom/virtual token reserve.

### Derivation of Graduation Boundary Condition:
At start ($r = 0$, $t = 0$):
$$ R_0 = R_v, \quad T_0 = T_v, \quad k = R_v \cdot T_v $$

At graduation ($r = R_{\text{target}} = 41.6\text{ NVDA}$, $t = T_{\text{sale}} = 800,000,000\text{ MEME}$):
$$ (R_v + 41.6) \times (T_v - 800,000,000) = R_v \cdot T_v $$
$$ R_v T_v + 41.6 T_v - 800,000,000 R_v - (41.6 \times 800,000,000) = R_v T_v $$
$$ 41.6 T_v - 800,000,000 R_v = 33,280,000,000 $$
$$ T_v = 800,000,000 \times \left(1 + \frac{R_v}{41.6}\right) $$

Setting $R_v = 10.4\text{ NVDA}$ ($\frac{1}{4}$ of $41.6$):
$$ T_v = 800,000,000 \times (1 + 0.25) = 1,000,000,000\text{ MEME} $$

---

## 4. Price & Valuation Dynamics

### Spot Price Formula:
$$ P(r) = \frac{R_v + r}{T_v - t} \quad (\text{denominated in NVDA per MEME}) $$

- **Starting Spot Price ($P_0$):**
  $$ P_0 = \frac{10.4\text{ NVDA}}{1,000,000,000\text{ MEME}} = 1.04 \times 10^{-8}\text{ NVDA/MEME} $$
  - **Initial FDV:** $10^9 \times P_0 = 10.4\text{ NVDA}$.

- **Graduation Spot Price ($P_{\text{grad}}$):**
  At graduation, $R_v + r = 10.4 + 41.6 = 52.0\text{ NVDA}$, and $T_v - t = 10^9 - 8\times 10^8 = 200,000,000\text{ MEME}$.
  $$ P_{\text{grad}} = \frac{52.0\text{ NVDA}}{200,000,000\text{ MEME}} = 2.60 \times 10^{-7}\text{ NVDA/MEME} $$
  - **Graduation FDV:** $10^9 \times P_{\text{grad}} = 260.0\text{ NVDA}$.
  - **Price Appreciation:** $\frac{2.60 \times 10^{-7}}{1.04 \times 10^{-8}} = 25.0\times$ (2,400% gain from curve start to finish).

- **Post-Graduation DEX Initial Liquidity:**
  - Deposited Quote: $41.6\text{ NVDA}$
  - Deposited Tokens: $200,000,000\text{ MEME}$
  - Resulting Uniswap V2 Initial Price: $\frac{41.6\text{ NVDA}}{200,000,000\text{ MEME}} = 2.08 \times 10^{-7}\text{ NVDA/MEME}$.

---

## 5. Trade Execution Mathematics & Rounding Rules

### 5.1 BUY Transaction: $\Delta R \to \Delta T$
Given exact quote input $\Delta R$ (`quoteAmountIn`):
$$ \Delta T = \frac{T_{\text{current}} \times \Delta R}{R_{\text{current}} + \Delta R} $$
Where:
- $R_{\text{current}} = R_v + r$
- $T_{\text{current}} = T_v - t$

**Solidity Integer Rounding Rule:**
- The division $\frac{T_{\text{current}} \times \Delta R}{R_{\text{current}} + \Delta R}$ **rounds DOWN** (standard EVM integer division `/`).
- Rounding down tokens paid to the buyer guarantees that the curve **never overpays tokens**.

### 5.2 SELL Transaction: $\Delta T \to \Delta R$
Given exact token input $\Delta T$ (`tokenAmountIn`):
$$ \Delta R = \frac{R_{\text{current}} \times \Delta T}{T_{\text{current}} + \Delta T} $$

**Solidity Integer Rounding Rule:**
- The division $\frac{R_{\text{current}} \times \Delta T}{T_{\text{current}} + \Delta T}$ **rounds DOWN** (standard EVM integer division `/`).
- Rounding down quote paid to the seller guarantees that the curve **never overpays quote reserves**.

---

## 6. Economic Simulation Table (Milestone Progression)

| Cumulative Real Quote ($r$) | Tokens Sold ($t$) | Remaining Sale Tokens | Spot Price (NVDA/MEME) | FDV (NVDA) | Curve Progress % |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **0.00 NVDA (Start)** | 0 MEME | 800,000,000 MEME | $1.040 \times 10^{-8}$ | 10.40 NVDA | 0.00% |
| **1.00 NVDA** | 87,719,298 MEME | 712,280,702 MEME | $1.250 \times 10^{-8}$ | 12.50 NVDA | 2.40% |
| **5.00 NVDA** | 324,675,324 MEME | 475,324,676 MEME | $2.280 \times 10^{-8}$ | 22.80 NVDA | 12.02% |
| **10.00 NVDA** | 490,196,078 MEME | 309,803,922 MEME | $4.160 \times 10^{-8}$ | 41.60 NVDA | 24.04% |
| **20.00 NVDA** | 657,894,736 MEME | 142,105,264 MEME | $8.890 \times 10^{-8}$ | 88.90 NVDA | 48.08% |
| **30.00 NVDA** | 742,574,257 MEME | 57,425,743 MEME | $15.69 \times 10^{-8}$ | 156.9 NVDA | 72.12% |
| **40.00 NVDA** | 793,650,793 MEME | 6,349,207 MEME | $24.80 \times 10^{-8}$ | 248.0 NVDA | 96.15% |
| **41.60 NVDA (Graduation)** | **800,000,000 MEME** | **0 MEME** | **$2.600 \times 10^{-8}$** | **260.0 NVDA** | **100.00%** |

---

## 7. Strict Reserve Invariants

The following invariants MUST hold true after every operation:
1. **Supply Conservation:** `memeToken.totalSupply() == 1,000,000,000 * 10^18` permanently.
2. **Curve Token Balance:** `memeToken.balanceOf(curve) == (T_sale - t) + T_dex`.
3. **Real Quote Solvency:** `quoteToken.balanceOf(curve) >= r`.
4. **Graduation Ceiling:** $r \le R_{\text{target}}$ during active trading.
5. **Post-Graduation Freeze:** When `state == State.GRADUATED`, all `buy()` and `sell()` calls revert.
6. **No Free Creator Minting:** Creator balance immediately after launch is exactly $0$.

---

## 8. Security & Edge Case Handling

- **Reentrancy Protection:** All trading functions implement OpenZeppelin's `ReentrancyGuard`.
- **Safe Transfers:** All quote and meme token transfers use OpenZeppelin's `SafeERC20`.
- **Deadline Enforcement:** `require(block.timestamp <= deadline, "EXPIRED")`.
- **Slippage Enforcement:** `require(tokensOut >= minTokensOut, "SLIPPAGE_EXCEEDED")` and `require(quoteOut >= minQuoteOut, "SLIPPAGE_EXCEEDED")`.
- **Zero Input Guards:** `require(amountIn > 0, "ZERO_AMOUNT")`.
- **Atomic Linking:** The factory deploys the token, creates the curve, and mints the entire 1B token supply directly into the curve in a single atomic transaction.
