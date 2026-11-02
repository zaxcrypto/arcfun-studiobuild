# ArcFun UI Visual System — Permanent Source of Truth

> [!IMPORTANT]
> **PERMANENT UI RULE**  
> ArcFun's current UI is the visual source of truth.  
> Future Launchpad, Token Page, Trading, Chart, Graduation, DEX, Holder Reward, and other functionality must be implemented inside this existing visual system.  
> 
> Do not independently redesign existing components.  
> New functionality must preserve the existing:  
> - Layout & spacing  
> - Typography & hierarchy  
> - Colors & gradients  
> - Borders & radii  
> - Interaction patterns & micro-animations  
> - Responsive behavior  
> 
> Any intentional visual change requires explicit approval.

---

## 1. Design Philosophy & Aesthetic Identity

ArcFun utilizes a **Modern Monochromatic Luxury Terminal** aesthetic with:
- High-contrast, deep surfaces (#000000 dark mode root, #070709 surface, #111114 glass surface).
- Crisp, rounded container geometry (24px - 28px card radius, 99px pill action buttons).
- Curated border accents (gba(255, 255, 255, 0.16) dark mode border).
- Distinctive Dinari tokenized stock integration badges (e.g. green NVIDIA dShare indicator).

---

## 2. Color System & Design Tokens

### Dark Theme (Default Primary)
| Token | Value | Purpose |
| :--- | :--- | :--- |
| --bg | #000000 | Global application background |
| --bg-default | #18181C | Input backgrounds, capsule tracks, muted chips |
| --surface | #070709 | Primary card background |
| --surface-glass | #111114 | Floating modals, flyouts, and dropdowns |
| --surface-soft | #151922 | Secondary panel backgrounds |
| --border | gba(255, 255, 255, 0.16) | Primary structural borders |
| --border-soft | gba(255, 255, 255, 0.09) | Subdued card & divider borders |
| --text-primary | #FFFFFF | Primary headers, values, active tabs |
| --text-secondary| #A1A1AA | Body copy, secondary stats |
| --text-muted | #71717A | Labels, placeholders, footnotes |
| --accent | #FFFFFF | Primary focus states and highlights |
| --accent-red | #EF4444 | Errors, sell states, warning alerts |
| --accent-green| #10B981 / #34D399 | Buy states, graduated status, success |
| --accent-orange| #F97316 | Pending transactions, alerts |

### Geometry & Radii
- **Cards & Primary Panels:** 24px to 28px (--radius-card)
- **Pill Buttons & Tabs:** 99px (--radius-btn)
- **Inputs & Stat Boxes:** 14px to 18px
- **Badges & Tags:** 8px to 12px

---

## 3. Typography Hierarchy

- **Font Family:** ar(--font-geist), -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif
- **Monospace (Addresses & Raw Math):** ar(--font-mono), monospace

| Role | Size | Weight | Letter Spacing |
| :--- | :--- | :--- | :--- |
| **Hero / Token Title** | 24px - 28px | 800 (Bold) | -0.02em |
| **Spot Price Hero** | 32px | 800 (Bold) | -0.03em |
| **Card Header** | 18px - 20px | 700 | Normal |
| **Section Labels** | 12px - 13px | 600 - 700 | Normal |
| **Input Values** | 26px | 700 | Normal |
| **Button Text** | 13.5px - 14px | 700 (Bold) | Normal |
| **Footnotes & Metadata**| 11.5px - 12px | 500 - 600 | Normal |

---

## 4. Component Layout & Structural Hierarchy

### 1. Launchpad (/launchpad & Root)
- **Header:** Sticky navigation with network pill, wallet slide-over button, faucet hub trigger, and theme toggle.
- **Top Segmented Tabs:** 99px pill switcher (New Token, Bonding Curve Explorer, Dinari Stocks).
- **Creation Wizard / Modal:** Left-aligned form layout with real-time stock catalog picker, image upload dropzone, token name/symbol inputs, and deploy button.
- **Token Explorer Grid:** 6 tokens per row responsive card grid displaying token badge, paired stock badge, real-time market cap, curve progress bar, and creator details.

### 2. Token Trading Page (/token/[address])
- **Page Container:** max-width: 1240px, centered with 24px 20px 80px 20px padding.
- **Top Breadcrumb:** Left arrow with token path and right-aligned Sepolia live refresh pill.
- **2-Column Terminal Layout:**
  - **Left Column (1.45fr):**
    1. **Token Identity Card (24px radius):** Avatar with paired stock badge, Title, Ticker chip, Etherscan link, Social links, and Project Narrative.
    2. **Spot Price & Progress Card (24px radius):** Spot price hero (32px), FDV, Graduation progress bar (10px height), and Real quote vs Target breakdown.
    3. **Trading Chart Panel:** High-resolution interactive chart matching container radius with live price feed.
    4. **Market Stats Grid:** 4-column responsive cards (Quote Reserve, Tokens Sold, Reserved DEX 200M Allocation, Bonding Curve State).
  - **Right Column (minmax 360px, 1fr):**
    1. **Interactive Swap Terminal:** Segmented Buy/Sell capsule, slippage settings dropdown, Pay input card, direction arrow divider, Receive output card, minimum received breakdown, and action button (Connect / Switch Network / Approve / Swap).
    2. **User Portfolio Card:** User token balance and estimated quote asset value.

---

## 5. Responsive Behavior Rules

- **Desktop (>= 1024px):** 2-column layout (1.45fr left, 1fr right), 28px grid gap.
- **Tablet (768px - 1023px):** Single column stack, chart adjusts height to 360px, trading terminal full width.
- **Mobile (< 768px):** Full single column stack, padding reduced to 16px 12px, input font sizes set to 16px+ (prevents iOS auto-zoom distortion), sticky action buttons.

---

## 6. Real Data & No-Mock Policy

All displayed data on the Token Page and Launchpad originates from:
1. **Ethereum Sepolia On-Chain Contracts:** ArcFunBondingCurve.sol, ArcFunCurveFactory.sol, ERC20.sol
2. **Dinari dShare Tokenized Stock APIs:** Real stock tickers, contract addresses, and trading status.
3. **ArcFun Supabase Database:** Real project records, logos, social links, and creator wallets.

No simulated or fabricated candlestick/historical trades are permitted.
