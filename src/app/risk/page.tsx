import { LegalPageShell, LegalSection } from "@/components/legal-page-shell";
import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Risk Disclosure | ArcFun",
  description: "Important risk disclosure and warnings regarding decentralized finance, cross-chain bridging, and meme token trading on ArcFun.",
};

export default function RiskPage() {
  return (
    <LegalPageShell
      title="Risk Disclosure"
      subtitle="Please read this Risk Disclosure carefully before interacting with ArcFun cross-chain bridge interfaces, native smart wallets, or Web3 chat payments."
      docType="risk"
    >
      <div style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.25)", borderRadius: 14, padding: "16px 18px", color: "rgba(255, 255, 255, 0.85)", fontSize: 13.5, lineHeight: 1.7 }}>
        <strong style={{ color: "#ef4444" }}>CRITICAL WARNING:</strong> Interacting with cryptocurrencies, decentralized finance (DeFi), cross-chain bridges, and decentralized smart contracts involves financial and technical risk. You may lose 100% of the funds you deploy. Never trade capital you cannot afford to lose completely.
      </div>

      <LegalSection title="1. Non-Custodial Architecture & Custody Boundaries">
        <p>
          ArcFun is a non-custodial software interface. ArcFun does not custody users&apos; assets, hold private keys, or maintain customer balances. Transactions are authorized directly by users and executed through autonomous on-chain protocols.
        </p>
        <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>You maintain sole and exclusive responsibility for your credentials, Passkeys, passwords, and device security.</li>
          <li>If you lose your credentials or device access, ArcFun has no technical capability to recover your funds or reverse on-chain transactions.</li>
          <li>You are responsible for carefully verifying all transaction amounts, recipient addresses, and token contracts prior to signing.</li>
        </ul>
      </LegalSection>

      <LegalSection title="2. ArcFun Wallet & Third-Party Programmable Wallet Infrastructure Risk">
        <p>
          ArcFun Wallet is powered by Circle Internet Financial, LLC (&quot;Circle&quot;) utilizing Circle&apos;s Programmable Wallets / Developer-Controlled Wallets (DCW) platform:
        </p>
        <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <li><strong style={{ color: "#fff" }}>Zero ArcFun Custody:</strong> ArcFun does not hold, access, or custody your digital assets or private keys. ArcFun is strictly an application software interface.</li>
          <li><strong style={{ color: "#fff" }}>Third-Party Infrastructure Dependency:</strong> Key generation, enclave signing, multi-party computation (MPC), and blockchain node communications are performed by Circle&apos;s independent infrastructure. ArcFun does not own, operate, or control Circle&apos;s internal servers, HSMs, or security systems.</li>
          <li><strong style={{ color: "#fff" }}>Third-Party Outages, Exploits &amp; Disruptions:</strong> Any disruption, outage, technical failure, zero-day exploit, security vulnerability, cloud partition, service cessation, or regulatory action affecting Circle or underlying blockchain networks may impair your ability to access, transfer, or recover your funds. <strong style={{ color: "#ef4444" }}>ArcFun bears zero liability for any such events</strong>.</li>
          <li><strong style={{ color: "#fff" }}>No Insurance or Reimbursement:</strong> Digital assets in your ArcFun Wallet are NOT insured by the FDIC, SIPC, Circle, or ArcFun. ArcFun is under no obligation to refund, reimburse, or compensate users for any lost or depleted balances resulting from third-party infrastructure compromises or blockchain events.</li>
          <li><strong style={{ color: "#fff" }}>Voluntary Funding at User Risk:</strong> You must ONLY fund or use an ArcFun Wallet if you fully understand and accept all third-party infrastructure, protocol, and volatility risks. If you do not accept these risks, do not create or deposit into an ArcFun Wallet.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Market Volatility & Total Loss of Capital">
        <p>
          Digital assets and meme tokens are speculative and subject to extreme price volatility. Token prices can surge or collapse rapidly within seconds. There are no guaranteed returns, price floors, or liquidity assurances.
        </p>
      </LegalSection>

      <LegalSection title="4. Web3 Chat & Autopay Execution Risks">
        <p>Features that enable peer-to-peer messaging and automated recurring transfers carry specific operational considerations:</p>
        <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <li><strong style={{ color: "#fff" }}>Irreversible Payments:</strong> In-chat transfers execute directly on public blockchains and cannot be recalled, stopped, or refunded once submitted.</li>
          <li><strong style={{ color: "#fff" }}>Autopay Execution &amp; Gas:</strong> Scheduled autopay executions require sufficient token balances and network gas. If balances are depleted or gas spikes exceed limits, executions safely pause.</li>
          <li><strong style={{ color: "#fff" }}>Social Engineering &amp; Impersonation:</strong> Malicious actors may attempt to solicit transfers via messaging. ArcFun will never message you requesting funds, seed phrases, or private keys.</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. ArcFun Bridge & Circle CCTP Dependencies">
        <p>
          Cross-chain transfers via the ArcFun Bridge rely on Circle&apos;s Cross-Chain Transfer Protocol (CCTP) and multi-chain network synchronization:
        </p>
        <ul style={{ paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <li><strong style={{ color: "#fff" }}>Block Finality &amp; Attestation Delays:</strong> Transfers require waiting for source-chain block confirmations before Circle Iris generates an attestation (typically 1–5 minutes, but longer during network congestion or reorganizations).</li>
          <li><strong style={{ color: "#fff" }}>Destination Execution:</strong> Relayer fulfillment depends on destination chain RPC availability and gas conditions. If relaying is delayed, users can complete transfers manually using the /recover self-claim flow.</li>
          <li><strong style={{ color: "#fff" }}>Third-Party Dependency:</strong> ArcFun integrates with third-party infrastructure, including Circle&apos;s CCTP where applicable. Failures, delays, outages, protocol changes, or other issues affecting third-party infrastructure may affect ArcFun functionality. Circle does not guarantee transactions or insure user funds against losses.</li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Smart Contract & Blockchain Vulnerabilities">
        <p>
          Smart contracts execute autonomously on public networks. Despite rigorous development standards, smart contracts may contain unforeseen software bugs, mathematical edge cases, validator reorganizations, network forks, or malicious exploits. Once a transaction is confirmed on-chain, it cannot be reversed by ArcFun.
        </p>
      </LegalSection>

      <LegalSection title="9. No Financial or Investment Advice">
        <p>
          Nothing on the ArcFun interface constitutes investment, financial, legal, tax, or trading advice. All charts, market caps, token metrics, and data feeds are provided strictly for informational purposes. You execute all transactions at your own risk.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
