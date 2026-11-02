"use client";

import { useState, useCallback, useRef } from "react";
import { usePublicClient, useWriteContract, useWalletClient, useAccount, useSwitchChain, useConfig } from "wagmi";
import { getWalletClient, getPublicClient } from "@wagmi/core";
import { pad, createPublicClient, http, fallback, stringToHex, padHex, toHex, concat, parseUnits, encodePacked, zeroAddress, keccak256 } from "viem";
import { CircleBridgeKitService } from "@/lib/bridge/circle-bridge-kit-service";
import { isFastTransferSupported } from "@/config/mainnet-chain-registry";
import { ChainRegistry } from "@/lib/bridge/chain-registry";
import {
  ERC20_APPROVE_ABI,
  isMainnetChain,
} from "@/config/swap-contract";
import {
  TOKEN_MESSENGER_V2_ABI,
  MESSAGE_TRANSMITTER_V2_ABI,
  CCTP_DOMAINS,
  MAINNET_CCTP_DOMAINS,
  getCctpDomains,
  resolveCctpDomain,
  pollCCTPAttestation,
  EURC_TOKEN_ID,
  CIRBTC_TOKEN_ID,
  CROSS_CHAIN_TOKEN_SERVICE_ADDRESS,
  CCTS_TOKEN_MANAGER_ADDRESS,
  CIRBTC_TOKEN_MANAGER_ADDRESS,
  CROSS_CHAIN_TOKEN_SERVICE_ABI,
} from "@/lib/bridge/cctp-provider";
import { saveTxHistory } from "@/lib/tx-history-store";
import { AppKit } from "@circle-fin/app-kit";
import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import { rateLimitedFetch } from "@/lib/rpc-queue";
import { isUserWalletRejection } from "@/lib/bridge/rejection-detector";
import { clearHistoryCache } from "@/hooks/use-onchain-history";
import { createSolanaAdapterFromProvider } from "@circle-fin/adapter-solana";
import { Solana, SolanaDevnet } from "@circle-fin/app-kit/chains";

// Configure reliable RPC endpoints for Circle AppKit / Solana Adapter
// The default public endpoint (api.mainnet-beta.solana.com) explicitly blocks browser dApps with HTTP 403 Forbidden.
// We configure the verified Alchemy endpoint with publicnode failover.
const solanaMainnetRpc = process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL || process.env.SOLANA_MAINNET_RPC_URL || "https://solana-rpc.publicnode.com";
const solanaDevnetRpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

if (Solana && Array.isArray((Solana as any).rpcEndpoints)) {
  (Solana as any).rpcEndpoints = [
    solanaMainnetRpc,
    "https://solana-rpc.publicnode.com"
  ];
}
if (SolanaDevnet && Array.isArray((SolanaDevnet as any).rpcEndpoints)) {
  (SolanaDevnet as any).rpcEndpoints = [
    solanaDevnetRpc
  ];
}
import { PublicKey } from "@solana/web3.js";
import bs58 from 'bs58';
import { useWallet } from "@solana/wallet-adapter-react";
import { supabase } from "@/lib/supabase";
import { StrKey } from "@stellar/stellar-sdk";
import { useStellar } from "@/lib/stellar-provider";
import { StellarClient } from "@/lib/bridge/adapters/stellar-client";
import { useSuiWallet } from "@/lib/sui-provider";
import { useSignTransaction } from "@mysten/dapp-kit";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { fromBase64 } from "@mysten/sui/utils";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiCctpConfig, padAddressToBytes32 } from "@/lib/bridge/sui-cctp-config";
import { EVM_RECEIVE_MESSAGE_GAS_UNITS } from "@/lib/bridge/gas-monitor";

let kitInstance: AppKit | null = null;
function getKit() {
  if (!kitInstance) {
    kitInstance = new AppKit();
    const workingArcRpc = process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com";
    const arcTestnet = kitInstance.getSupportedChains().find((c: any) => c.id === 5042002 || c.chain?.toLowerCase().includes("arc"));
    if (arcTestnet) {
      (arcTestnet as any).rpcEndpoints = [
        workingArcRpc,
        "https://5042002.rpc.thirdweb.com"
      ];
      if ((arcTestnet as any).rpcUrls) {
        (arcTestnet as any).rpcUrls.default = { http: [workingArcRpc] };
        (arcTestnet as any).rpcUrls.public = { http: [workingArcRpc] };
      }
    }
    const injTestnet = kitInstance.getSupportedChains().find(c => c.chain === "Injective_Testnet");
    if (injTestnet) {
      injTestnet.rpcEndpoints = [
        "https://k8s.testnet.json-rpc.injective.network/",
        "https://injectiveevm-testnet-rpc.polkachu.com"
      ];
    }
  }
  return kitInstance;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type MilestoneStatus = "pending" | "active" | "done" | "failed";

export interface Milestone {
  id: string;
  label: string;
  status: MilestoneStatus;
  startedAt?: number;
  completedAt?: number;
  txHash?: string;
}
export type EngineState = "idle" | "running" | "success" | "failed" | "already_completed" | "pending" | "mint_rejected" | "claim_manual_required" | "attestation_pending";
export interface TxSummary {
  fromAmt: string;
  fromAsset: string;
  toAmt?: string;
  toAsset?: string;
  type: "bridge" | "other";
  sourceChain?: string;
  destChain?: string;
  burnHash?: string;
  manualClaim?: boolean;
}

export interface TxEngineOutput {
  state: EngineState;
  milestones: Milestone[];
  txHash: string | null;
  burnHash: string | null;
  mintHash: string | null;
  gasUsed: bigint | null;
  gasPricePaid: bigint | null;
  error: string | null;
  totalMs: number | null;
  blockNumber: bigint | null;
  summary: TxSummary | null;
  manualClaimPayload?: {
    message: string;
    attestation: string;
    destinationDomain?: number;
    destChain?: string;
    burnHash?: string;
  } | null;
  executeBridge: (params: BridgeParams) => Promise<void>;
  executeResume: (pendingObj: any, onComplete?: () => void) => Promise<void>;
  executeManualClaim: (customPayload?: any) => Promise<void>;
  dismiss: () => void;
}

export interface BridgeParams {
  tokenIn: `0x${string}`;
  amount: bigint;
  destChainId: number;
  allowance: bigint;
  route: "cctp" | "arcfun";
  sourceChain: string;   // e.g. "Ethereum Sepolia"
  destChain: string;     // e.g. "Arc Testnet"
  fromAsset: string;
  toAsset: string;
  formattedAmount: string;
  destAddress?: string;
  manualClaim?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nowMs() {
  return Date.now();
}

function activateMilestone(milestones: Milestone[], id: string): Milestone[] {
  return milestones.map((m) => {
    if (m.id === id) {
      return { ...m, status: "active", startedAt: m.startedAt || nowMs(), completedAt: undefined };
    }
    // Prevent simultaneous active milestones: downstream milestones cannot remain active
    if (id === "attestation" && m.id === "mint" && m.status === "active") {
      return { ...m, status: "pending", startedAt: undefined, completedAt: undefined };
    }
    if (id === "burn" && (m.id === "attestation" || m.id === "mint") && m.status === "active") {
      return { ...m, status: "pending", startedAt: undefined, completedAt: undefined };
    }
    return m;
  });
}

function completeMilestone(milestones: Milestone[], id: string, txHash?: string): Milestone[] {
  return milestones.map((m) => {
    if (m.id === id) {
      let label = m.label;
      if (id === "mint" && label.toLowerCase().includes("in progress")) {
        label = label.replace(/ing in progress/i, "").replace(/in progress/i, "").trim();
        if (!label || label === "Mint") label = "Tokens Minted";
      }
      return { ...m, label, status: "done", completedAt: m.completedAt || nowMs(), ...(txHash ? { txHash } : {}) };
    }
    return m;
  });
}

function failMilestone(milestones: Milestone[], id: string): Milestone[] {
  return milestones.map((m) =>
    m.id === id ? { ...m, status: "failed", completedAt: nowMs() } : m
  );
}

function parseRevertReason(e: unknown): string {
  const err = e as any;
  const msg: string = err?.shortMessage || err?.message || "";

  if (msg.includes("PENDING_ATTESTATION") || msg.includes("Attestation still pending")) return "Circle Iris API is still generating the attestation signature for this burn. Please wait a few moments and click Resume / Retry Mint.";
  if (msg.includes("CLAIM_IN_PROGRESS") || msg.includes("Race condition prevented")) return "A claim process is currently active. Please wait 10 seconds and click Resume / Retry Mint.";
  if (msg.includes("ERR_STELLAR_MISSING_TRUSTLINE")) return "Destination wallet is missing a USDC trustline.";
  if (msg.includes("ERR_STELLAR_ACCOUNT_NOT_FOUND")) return "Destination Stellar account does not exist.";
  if (msg.includes("ERR_STELLAR_INSUFFICIENT_XLM")) return "Insufficient native balance. Minimum reserve required.";
  if (msg.includes("ERR_STELLAR_UNAUTHORIZED_TRUSTLINE")) return "Wallet is not authorized to hold this asset.";
  if (msg.includes("ERR_TRANSACTION_EXPIRED")) return "Transaction expired. Please approve faster.";
  if (msg.includes("ERR_NETWORK_UNAVAILABLE")) return "Unable to connect to the destination network.";
  if (msg.includes("ERR_TRANSACTION_FAILED")) return "Transaction failed on the destination network.";
  if (msg.includes("ALREADY_CLAIMED")) return "This transaction has already been completed on the destination network.";
  if (
    msg.includes('"InstructionError":[1,{"Custom":0}]') ||
    msg.includes('"Custom":0') ||
    (msg.includes('InstructionError') && msg.includes('Custom'))
  ) {
    return "Your Solana wallet is missing a USDC Associated Token Account (ATA). Please mint some Devnet USDC from the Circle Faucet (faucet.circle.com) to automatically initialize it, then click Claim again.";
  }

  if (
    msg.includes("Freighter") ||
    msg.includes("rejected by wallet") ||
    msg.includes("signing rejected") ||
    msg.includes("unlocked")
  ) {
    return "Please make sure your Freighter wallet is unlocked, then refresh the page and try again.";
  }

  if (
    msg.includes("User rejected") ||
    msg.includes("user rejected") ||
    msg.includes("ACTION_REJECTED") ||
    msg.includes("ERR_USER_REJECTED")
  ) {
    return "Transaction cancelled by user.";
  }
  const detail: string =
    err?.cause?.reason ||
    err?.cause?.data?.errorName ||
    err?.data?.message ||
    "";
  if (detail) return detail;
  const revertMatch = msg.match(/reverted with reason string '(.+?)'/);
  if (revertMatch) return revertMatch[1];
  const customMatch = msg.match(/reverted with the following reason:\n(.+)/);
  if (customMatch) return customMatch[1].trim();
  if (msg) return msg.replace(/^(execution reverted: )/i, "").replace(/^(Execution Failed: )/i, "").slice(0, 200);
  return "Transaction failed. No revert reason available.";
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTxEngine(): TxEngineOutput {
  const config = useConfig();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();
  const { address: evmAddress, connector } = useAccount();
  const solanaWallet = useWallet();
  const stellarWallet = useStellar();
  const suiWallet = useSuiWallet();
  const { mutateAsync: signSuiTx } = useSignTransaction();
  const address = evmAddress || (solanaWallet.publicKey ? solanaWallet.publicKey.toBase58() : undefined) || stellarWallet.address || suiWallet.address || "";



  const [state, setState] = useState<EngineState>("idle");
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [burnHash, setBurnHash] = useState<string | null>(null);
  const [mintHash, setMintHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalMs, setTotalMs] = useState<number | null>(null);
  const [blockNumber, setBlockNumber] = useState<bigint | null>(null);
  const [summary, setSummary] = useState<TxSummary | null>(null);
  const [gasUsed, setGasUsed] = useState<bigint | null>(null);
  const [gasPricePaid, setGasPricePaid] = useState<bigint | null>(null);
  const [manualClaimPayload, setManualClaimPayload] = useState<{
    message: string;
    attestation: string;
    destinationDomain?: number;
    destChain?: string;
    burnHash?: string;
  } | null>(null);

  const startTimeRef = useRef<number>(0);
  const isBridgeActiveRef = useRef<boolean>(false);
  const activeIntervalsRef = useRef<any[]>([]);

  const clearEngineIntervals = useCallback(() => {
    activeIntervalsRef.current.forEach((id) => {
      try { clearInterval(id); } catch (_) {}
    });
    activeIntervalsRef.current = [];
  }, []);

  const syncBridgeWithRetry = async (payload: any, token: string = "", isMainnet: boolean = false): Promise<boolean> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-arcfun-network': isMainnet ? 'mainnet' : 'testnet'
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const res = await fetch('/api/bridge/sync', {
          method: 'POST',
          headers,
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          console.log("[SYNC_SUCCESS] Bridge transaction synced with database successfully.");
          return true;
        }
        console.warn(`[SYNC_RETRY] /api/bridge/sync returned HTTP ${res.status}. Retrying (attempt ${attempt + 1}/5)...`);
      } catch (err: any) {
        console.warn(`[SYNC_RETRY_ERR] Network error during /api/bridge/sync: ${err?.message}. Retrying (attempt ${attempt + 1}/5)...`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    return false;
  };

  const reset = useCallback(() => {
    isBridgeActiveRef.current = false;
    clearEngineIntervals();
    setState("idle");
    setMilestones([]);
    setTxHash(null);
    setBurnHash(null);
    setMintHash(null);
    setError(null);
    setTotalMs(null);
    setBlockNumber(null);
    setSummary(null);
    setGasUsed(null);
    setGasPricePaid(null);
    setManualClaimPayload(null);
  }, [clearEngineIntervals]);

  const update = useCallback(
    (fn: (prev: Milestone[]) => Milestone[]) => {
      setMilestones((prev) => fn(prev));
    },
    []
  );

  // ─── Bridge ────────────────────────────────────────────────────────────────

  const executeBridge = useCallback(
    async (params: BridgeParams) => {
      if (!publicClient) return;
      const {
        tokenIn, amount, destChainId, allowance,
        route, sourceChain, destChain,
        fromAsset, toAsset, formattedAmount,
        manualClaim,
      } = params;

      // ══════════════════════════════════════════════════════════════════════
      // CCTP BRIDGE ROUTE MILESTONES & SOURCE CHAIN LIVE ALLOWANCE CHECK
      // ══════════════════════════════════════════════════════════════════════
      const isEvmSource = !sourceChain.includes("Solana") && !sourceChain.includes("Stellar") && !sourceChain.includes("Sui");
      
      let liveAllowance = allowance;
      const isMainnet = isMainnetChain(sourceChain) || isMainnetChain(destChain);
      const activeDomains = getCctpDomains(isMainnet ? "mainnet" : "testnet");
      const sourceDomainConfig = activeDomains[sourceChain] || resolveCctpDomain(sourceChain, isMainnet ? "mainnet" : "testnet");
      const sourceChainSafe = ChainRegistry.getChainSafe(sourceChain);
      const evmUserAddr = evmAddress || (connector ? (await connector.getAccounts?.())?.[0] : undefined);
      
      if (isEvmSource && sourceDomainConfig && evmUserAddr) {
        try {
          const isEurc = fromAsset === "EURC";
          const isCirBtc = fromAsset === "cirBTC";
          const messengerSpender = isCirBtc
            ? CIRBTC_TOKEN_MANAGER_ADDRESS
            : isEurc
            ? CCTS_TOKEN_MANAGER_ADDRESS
            : (sourceDomainConfig.tokenMessenger || "0x8fe6b999dc680ccfdd5bf7eb0974218be2542daa");
          const tokenAddr = isCirBtc
            ? (((sourceDomainConfig as any)?.cirBtc || (sourceChain === "Arc Testnet" ? "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf" : "0x3a3fe695f684bf9b9e43cf43c2b895ea5e392bb3")) as `0x${string}`)
            : isEurc
            ? (((sourceDomainConfig as any)?.eurc || (sourceChain === "Arc Testnet" ? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a" : "0x808456652fdb597867f38412077A9182bf77359F")) as `0x${string}`)
            : (sourceDomainConfig.usdc as `0x${string}`);
          
          const sourceRpc = sourceChainSafe?.rpcUrl || (sourceDomainConfig as any)?.rpcUrl;
          const directSourceClient = sourceRpc
            ? createPublicClient({ transport: http(sourceRpc, { timeout: 4000 }) })
            : publicClient;

          const onchainAllowance = await directSourceClient.readContract({
            address: tokenAddr,
            abi: ERC20_APPROVE_ABI,
            functionName: "allowance",
            args: [evmUserAddr as `0x${string}`, messengerSpender as `0x${string}`]
          }) as bigint;
          liveAllowance = onchainAllowance;
        } catch (_) {
          // If RPC allowance fetch fails, assume approval is needed for safety so UI never ticks prematurely
          liveAllowance = 0n;
        }
      }

      // If allowance is not verified >= amount, approval must be active (not done)
      const needsApproveStep = isEvmSource ? (liveAllowance < amount) : false;

      const formattedAmountStr = formattedAmount || (Number(amount) / 1e6).toString();
      const assetStr = fromAsset || "USDC";

      const isSolanaDest = destChain.toLowerCase().includes("solana");
      const isEvmDest =
        !isSolanaDest &&
        !destChain.toLowerCase().includes("stellar") &&
        !destChain.toLowerCase().includes("sui");
      const isManual = Boolean(manualClaim) && isEvmDest;

      const initial: Milestone[] = [
        { id: "appr", label: `Approve ${formattedAmountStr} ${assetStr}`, status: needsApproveStep ? "active" : "done", ...(needsApproveStep ? { startedAt: nowMs() } : { completedAt: nowMs() }) },
        { id: "burn", label: `Burn ${formattedAmountStr} ${assetStr}`, status: needsApproveStep ? "pending" : "active", ...(!needsApproveStep ? { startedAt: nowMs() } : {}) },
        { id: "attestation", label: "Iris Attestation", status: "pending" },
        ...(isManual ? [{ id: "switch", label: `Switch to ${destChain}`, status: "pending" as MilestoneStatus }] : []),
        { id: "mint", label: `Mint ${formattedAmountStr} ${assetStr}`, status: "pending" },
      ];

      setMilestones(initial);
      setState("running");
      setTxHash(null);
      setBurnHash(null);
      setMintHash(null);
      setError(null);
      setTotalMs(null);
      setBlockNumber(null);
      setGasUsed(null);
      setGasPricePaid(null);
      setSummary({ fromAmt: formattedAmount, fromAsset, toAsset, type: "bridge", sourceChain, destChain, manualClaim: Boolean(manualClaim) });
      startTimeRef.current = nowMs();

      let ms = [...initial];
      const set = (next: Milestone[]) => { ms = next; setMilestones([...next]); };

      let localBurnTx: string | null = null;
      let backgroundPollInterval: any = null;
      let claimPollInterval: any = null;
      let isForceResolved = false;
      let activeWalletClient = walletClient;
      let relayerInterceptedProvider: any = undefined;
      isBridgeActiveRef.current = true;
      try {
        // Auto-switch connected EVM wallet to source chain network if needed (EVM sources only)
        // Non-EVM chains (Solana, Stellar, Sui) use their own native wallet providers and must never invoke EVM switchChainAsync.
        // IMPORTANT: We query the wallet's ACTUAL chain ID via raw provider RPC,
        // NOT walletClient.chain?.id which is stale React state and causes chain mismatch errors.
        const sourceChainConfig = ChainRegistry.getChainSafe(sourceChain);
        if (isEvmSource && sourceChainConfig && sourceChainConfig.chainId > 0 && connector) {
          const targetChainId = sourceChainConfig.chainId;
          let currentChainId: number | undefined;
          try {
            const provider = await connector.getProvider();
            if (provider && typeof (provider as any).request === 'function') {
              const chainIdHex = await (provider as any).request({ method: 'eth_chainId' });
              currentChainId = typeof chainIdHex === 'string' ? parseInt(chainIdHex, 16) : Number(chainIdHex);
            }
          } catch {
            // Fallback to walletClient if provider query fails
            currentChainId = activeWalletClient?.chain?.id;
          }
          if (currentChainId && currentChainId !== targetChainId) {
            console.log(`[TxEngine] Auto-switching wallet network from ${currentChainId} to ${targetChainId} (${sourceChain})...`);
            try {
              if (switchChainAsync) {
                await switchChainAsync({ chainId: targetChainId });
                // After switching, get a fresh walletClient from wagmi's config store
                // to ensure all subsequent calls use the correct chain context.
                try {
                  activeWalletClient = await getWalletClient(config, { chainId: targetChainId });
                } catch {
                  // If getWalletClient fails, the original walletClient may still work
                  console.warn("[TxEngine] Could not refresh walletClient after chain switch, using original.");
                }
              }
            } catch (switchErr: any) {
              console.error("[TxEngine] Wallet network switch rejected or failed:", switchErr);
              if (isUserWalletRejection(switchErr)) {
                throw new Error(`User rejected network switch to ${sourceChain}. Please switch your wallet network to ${sourceChain} in Rabby/MetaMask and try again.`);
              }
              throw new Error(`Please switch your wallet network to ${sourceChain} (Chain ID ${targetChainId}) to continue.`);
            }
          }
        }

        // ══════════════════════════════════════════════════════════════════════
        // MAINNET CIRCLE BRIDGE KIT INTEGRATION (EVM Mainnet <-> EVM Mainnet)
        // ══════════════════════════════════════════════════════════════════════
        if (isMainnetChain(sourceChain) && isMainnetChain(destChain) && !sourceChain.includes("Solana") && !destChain.includes("Solana")) {
          console.log(`[TxEngine] Routing Mainnet transfer (${sourceChain} -> ${destChain}) through CircleBridgeKitService...`);
          
          const rawProvider = connector ? await connector.getProvider() : undefined;
          if (!rawProvider) {
            throw new Error("No browser wallet provider found. Please connect your wallet.");
          }

          set(activateMilestone(ms, "appr"));

          const burnResult = await CircleBridgeKitService.executeUserBurnAndAttest({
            sourceChain,
            destinationChain: destChain,
            amount: formattedAmount,
            provider: rawProvider as any,
            recipientAddress: params.destAddress || evmAddress,
            preferredSpeed: isFastTransferSupported(sourceChain, destChain) ? "FAST" : "SLOW",
            onProgress: (step, data) => {
              console.log(`[CircleBridgeKit Progress] ${step}:`, data);
              if (step === "APPROVING") {
                set(activateMilestone(ms, "appr"));
              } else if (step === "APPROVE_CONFIRMED") {
                set(activateMilestone(completeMilestone(ms, "appr", data?.txHash), "burn"));
              } else if (step === "BURNING") {
                set(activateMilestone(completeMilestone(ms, "appr"), "burn"));
              } else if (step === "BURN_CONFIRMED") {
                localBurnTx = data?.txHash;
                setBurnHash(data?.txHash);
                setTxHash(data?.txHash);
                set(activateMilestone(completeMilestone(ms, "burn", data?.txHash), "attestation"));
              }
            }
          });

          const burnHash = burnResult.burnTxHash;
          localBurnTx = burnHash;
          setBurnHash(burnHash);
          setTxHash(burnHash);

          // Burn is confirmed. Iris attestation is now in progress (spinner), and Minting remains pending.
          // Minting will ONLY become active when backend relayer verifies Iris attestation.
          set(activateMilestone(completeMilestone(ms, "burn", burnHash), "attestation"));

          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token || "";

          saveTxHistory({
            id: burnHash,
            txHash: burnHash,
            burnHash,
            mintHash: undefined,
            type: "bridge_cctp",
            status: "pending",
            amount: formattedAmount,
            fromAsset,
            toAsset,
            sourceChain,
            destChain,
            timestamp: Date.now(),
            userAddress: evmAddress
          });

          await syncBridgeWithRetry({
            wallet_address: params.destAddress || evmAddress,
            source_chain: sourceChain,
            destination_chain: destChain,
            token_symbol: fromAsset,
            amount: formattedAmount,
            burn_tx_hash: burnHash,
            source_address: evmAddress
          }, token);

          // Poll backend relayer to verify Circle Iris attestation and execute destination mint
          let claimRes: any;
          let claimData: any;
          for (let attempt = 0; attempt < 35; attempt++) {
            try {
              claimRes = await fetch('/api/bridge/claim', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                  'x-arcfun-network': 'mainnet',
                  'x-wallet-address': evmAddress || ''
                },
                body: JSON.stringify({
                  burn_tx_hash: burnHash,
                  source_chain: sourceChain,
                  destination_chain: destChain,
                  wallet_address: evmAddress,
                  amount: formattedAmount,
                  message: burnResult.messageBytes,
                  attestation: burnResult.attestation,
                  manual_claim: manualClaim
                })
              });
              claimData = await claimRes.json();
              if (claimData?.status === "MANUAL_CLAIM_REQUIRED" || claimData?.code === "RELAYER_LOW_GAS" || (manualClaim && (claimData?.message || claimData?.status === "READY_TO_CLAIM"))) {
                clearEngineIntervals();
                const claimPayload = {
                  message: claimData.message || burnResult.messageBytes,
                  attestation: claimData.attestation || burnResult.attestation,
                  destinationDomain: claimData.destination_domain,
                  destChain,
                  burnHash
                };
                setManualClaimPayload(claimPayload);

                // 1. Mark Iris Attestation as DONE with green checkmark!
                let updatedMs = completeMilestone(ms, "attestation");

                const destConfig = ChainRegistry.getChainSafe(destChain);
                const isSolana = destChain.toLowerCase().includes("solana");
                const isEvm = destConfig && destConfig.chainId > 0 && !isSolana;

                // Ensure "switch" step is present only for EVM destinations
                const hasSwitch = updatedMs.some((m) => m.id === "switch");
                if (!hasSwitch && isEvm) {
                  const attIdx = updatedMs.findIndex((m) => m.id === "attestation");
                  const switchNode: Milestone = { id: "switch", label: `Switch to ${destChain}`, status: "pending" };
                  updatedMs.splice(attIdx + 1, 0, switchNode);
                }

                if (isSolana) {
                  // Solana destination: User is on bridge page!
                  // Instantly activate mint milestone and auto-trigger destination claim!
                  updatedMs = activateMilestone(updatedMs, "mint");
                  set(updatedMs);
                  setState("running");
                  setError(null);
                  setTimeout(() => {
                    executeManualClaim(claimPayload);
                  }, 150);
                  return;
                }

                // Check wallet's current chain via raw provider to avoid stale React state
                let currentChainId = publicClient?.chain?.id;
                try {
                  const provider = connector ? await connector.getProvider() : undefined;
                  if (provider && typeof (provider as any).request === 'function') {
                    const chainIdHex = await (provider as any).request({ method: 'eth_chainId' });
                    currentChainId = typeof chainIdHex === 'string' ? parseInt(chainIdHex, 16) : Number(chainIdHex);
                  }
                } catch (_) {}

                const alreadyOnDest = isEvm && currentChainId === destConfig.chainId;

                if (alreadyOnDest) {
                  updatedMs = completeMilestone(updatedMs, "switch");
                  updatedMs = activateMilestone(updatedMs, "mint");
                  set(updatedMs);
                  setState("running");
                  setError(null);

                  // Auto-prompt destination claim transaction in user's wallet
                  setTimeout(() => {
                    executeManualClaim(claimPayload);
                  }, 100);
                  return;
                }

                // If not yet on destination: activate "switch" step and auto-prompt wallet switch
                updatedMs = activateMilestone(updatedMs, "switch");
                set(updatedMs);
                setState("running");
                setError(null);

                // Automatically trigger the network switch/add chain popup in user's wallet
                if (isEvm && switchChainAsync) {
                  try {
                    console.log(`[TxEngine] Auto-prompting wallet switch to ${destChain} (${destConfig.chainId})...`);
                    await switchChainAsync({ chainId: destConfig.chainId });
                    let postSwitchMs = completeMilestone(updatedMs, "switch");
                    postSwitchMs = activateMilestone(postSwitchMs, "mint");
                    set(postSwitchMs);
                    setState("running");
                    setError(null);
                    setTimeout(() => {
                      executeManualClaim(claimPayload);
                    }, 100);
                  } catch (switchErr) {
                    console.warn("[TxEngine] Wallet switch dismissed or cancelled by user:", switchErr);
                    // User dismissed the wallet switch prompt: show the manual Switch Network action button
                    setState("claim_manual_required");
                    setError(`Please switch your wallet network to ${destChain} to complete your claim.`);
                  }
                } else {
                  setState("claim_manual_required");
                  setError(`Please switch your wallet network to ${destChain} to complete your claim.`);
                }
                return;
              }
              if (claimRes.ok && claimData.success) {
                break;
              }
              if (claimRes.status === 409) {
                // Circle Iris attestation still pending on-chain.
                // Keep Iris Attestation active (spinner) and Mint pending (no spinner)!
                set(activateMilestone(completeMilestone(ms, "burn", burnHash), "attestation"));
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              break;
            } catch (fetchErr: any) {
              if (fetchErr && fetchErr.message && fetchErr.message.includes('Failed to fetch')) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              throw fetchErr;
            }
          }

          if (!claimRes || !claimData) throw new Error("Network timeout while claiming");
          if (!claimRes.ok) {
            const err = new Error(claimData.error || "Claim failed");
            (err as any).status = claimRes.status;
            throw err;
          }

          const mintTx = claimData.mint_tx_hash && claimData.mint_tx_hash !== "ALREADY_CLAIMED_ON_CHAIN" ? claimData.mint_tx_hash : burnHash;
          setMintHash(mintTx);

          // Real backend verification transition:
          // 1. Iris attestation signature was successfully verified by relayer -> complete "attestation"
          // 2. Activate "mint" milestone to show real on-chain claim submission before finalizing
          set(activateMilestone(completeMilestone(ms, "attestation"), "mint"));
          await new Promise((r) => setTimeout(r, 1500));

          // 3. Mark minting complete with actual destination transaction hash
          set(completeMilestone(completeMilestone(ms, "attestation"), "mint", mintTx));
          setTotalMs(nowMs() - startTimeRef.current);
          setState("success");

          saveTxHistory({
            id: burnHash,
            txHash: burnHash,
            burnHash,
            mintHash: mintTx,
            type: "bridge_cctp",
            status: "success",
            amount: formattedAmount,
            fromAsset,
            toAsset,
            sourceChain,
            destChain,
            timestamp: Date.now(),
            userAddress: evmAddress
          });
          clearHistoryCache(evmAddress);
          return;
        }

        if (destChain.includes("Stellar") && !sourceChain.includes("Solana")) {
          // ══════════════════════════════════════════════════════════════════════
          // NATIVE EVM -> STELLAR FLOW
          // ══════════════════════════════════════════════════════════════════════
          const activeDomains = getCctpDomains(isMainnetChain(sourceChain) || isMainnetChain(destChain) ? "mainnet" : "testnet");
          const sourceDomain = activeDomains[sourceChain] || resolveCctpDomain(sourceChain, isMainnetChain(sourceChain) ? "mainnet" : "testnet");
          const destDomain = activeDomains[destChain] || resolveCctpDomain(destChain, isMainnetChain(destChain) ? "mainnet" : "testnet");
          if (!sourceDomain || !destDomain) throw new Error("CCTP configuration missing for selected route");
          if (!params.destAddress) throw new Error("Destination address required for Stellar bridge");

          // The contract requires 0 < maxFee < amount; approve must cover amount + maxFee.
          const evmMaxFee = amount / 100n > 0n ? amount / 100n : 1n;
          const evmTotalApprove = amount + evmMaxFee;

          if (evmTotalApprove > liveAllowance) {
            set(activateMilestone(ms, "appr"));
            const apprTx = await writeContractAsync({
              chainId: sourceChainConfig?.chainId,
              address: sourceDomain.usdc as `0x${string}`,
              abi: ERC20_APPROVE_ABI,
              functionName: "approve",
              args: [sourceDomain.tokenMessenger as any, evmTotalApprove],
            });

            const apprReceipt = await publicClient.waitForTransactionReceipt({ hash: apprTx });
            if (apprReceipt.status !== "success") {
              throw new Error("Token approval reverted on-chain.");
            }
            set(completeMilestone(activateMilestone(ms, "burn"), "appr", apprTx));
          } else {
            set(completeMilestone(activateMilestone(ms, "burn"), "appr"));
          }

          if (!destDomain.cctpForwarder) throw new Error("CctpForwarder missing from Stellar domain config");

          const cctpForwarderRaw = StrKey.decodeContract(destDomain.cctpForwarder);
          const mintRecipient = "0x" + Buffer.from(cctpForwarderRaw).toString("hex");

          const destinationCaller = mintRecipient as `0x${string}`;

          const strBytesHex = stringToHex(params.destAddress);
          const strBytesLength = params.destAddress.length;

          // version = 0 (4 bytes), length (4 bytes)
          const versionHex = padHex("0x0", { size: 4 });
          const lengthHex = padHex(toHex(strBytesLength), { size: 4 });

          // CCTP Forwarder hook format: [32 bytes reserved space containing version & length at end] + [string bytes]
          // The buffer is 32 bytes reserved. version is at offset 24, length is at offset 28.
          // offsets 0-23 are zeros. 
          const padding24 = padHex("0x0", { size: 24 });

          const hookDataHex = concat([padding24, versionHex, lengthHex, strBytesHex]);

          // We skip simulateContract here because public RPC nodes often lag behind the
          // recently mined approval transaction, causing false-positive reverts.
          // writeContractAsync will naturally forward the tx to the user's wallet.

          const burnHash = await writeContractAsync({
            chainId: sourceChainConfig?.chainId,
            address: sourceDomain.tokenMessenger as any,
            abi: TOKEN_MESSENGER_V2_ABI,
            functionName: "depositForBurnWithHook",
            args: [
              amount,
              destDomain.domain,
              mintRecipient as `0x${string}`,
              sourceDomain.usdc as `0x${string}`,
              destinationCaller,
              evmMaxFee,
              1000,
              hookDataHex as `0x${string}`
            ],
          });

          localBurnTx = burnHash;
          setBurnHash(burnHash);
          setTxHash(burnHash);

          // Wait for burn transaction confirmation on-chain before advancing milestone
          let burnReceipt;
          try {
            burnReceipt = await (publicClient?.waitForTransactionReceipt({ hash: burnHash }) ?? Promise.reject(new Error("No public client available")));
          } catch (waitErr) {
            const fallbackRpc = sourceChainSafe?.rpcUrl || (sourceDomain as any)?.rpcUrl;
            if (fallbackRpc) {
              const directClient = createPublicClient({ transport: http(fallbackRpc, { timeout: 8000 }) });
              burnReceipt = await directClient.waitForTransactionReceipt({ hash: burnHash });
            } else {
              throw waitErr;
            }
          }

          if (burnReceipt && burnReceipt.status !== "success") {
            throw new Error(`Burn transaction reverted on-chain on ${sourceChain}. Transaction status: failed.`);
          }

          // Complete burn milestone with real hash and activate attestation
          set(completeMilestone(activateMilestone(ms, "attestation"), "burn", burnHash));
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token || "";

          saveTxHistory({ id: burnHash, txHash: burnHash, burnHash: burnHash, mintHash: undefined, type: "bridge_cctp", status: "pending", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: address });

          // ══════════════════════════════════════════════════════════════════════
          // Sync transaction with backend before claiming
          // ══════════════════════════════════════════════════════════════════════
          await fetch('/api/bridge/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              wallet_address: address,
              source_chain: sourceChain,
              destination_chain: destChain,
              token_symbol: fromAsset,
              amount: formattedAmount,
              burn_tx_hash: burnHash
            })
          });

          let claimRes: any;
          let claimData: any;
          for (let attempt = 0; attempt < 25; attempt++) {
            try {
              const isMainnetReq = isMainnetChain(sourceChain) || isMainnetChain(destChain);
              claimRes = await fetch('/api/bridge/claim', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                  'x-arcfun-network': isMainnetReq ? 'mainnet' : 'testnet'
                },
                body: JSON.stringify({
                  burn_tx_hash: burnHash,
                  source_chain: sourceChain,
                  destination_chain: destChain,
                  wallet_address: address,
                  amount: formattedAmount,
                  manual_claim: manualClaim
                })
              });
              claimData = await claimRes.json();
              if (claimData?.status === "MANUAL_CLAIM_REQUIRED" || claimData?.code === "RELAYER_LOW_GAS" || (manualClaim && (claimData?.message || claimData?.status === "READY_TO_CLAIM"))) {
                clearEngineIntervals();
                const claimPayload = {
                  message: claimData.message,
                  attestation: claimData.attestation,
                  destinationDomain: claimData.destination_domain,
                  destChain,
                  burnHash
                };
                setManualClaimPayload(claimPayload);

                const isSolana = destChain.toLowerCase().includes("solana");
                if (isSolana) {
                  set(completeMilestone(activateMilestone(ms, "mint"), "attestation"));
                  setState("running");
                  setError(manualClaim ? "Self-mint in progress. Please confirm the mint transaction in your destination wallet." : null);
                  setTimeout(() => {
                    executeManualClaim(claimPayload);
                  }, 150);
                  return;
                }

                set(completeMilestone(activateMilestone(ms, "mint"), "attestation"));
                setError(claimData.error || claimData.reason || "Self-mint enabled. Complete your claim below using your destination wallet.");
                setState("claim_manual_required");
                return;
              }
              if (claimRes.ok && claimData.success) break;
              if (claimRes.status === 409) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              break;
            } catch (fetchErr: any) {
              if (fetchErr && fetchErr.message && fetchErr.message.includes('Failed to fetch')) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              throw fetchErr;
            }
          }
          if (!claimRes || !claimData) throw new Error("Network timeout while claiming");
          if (!claimRes.ok) {
            const err = new Error(claimData.error || "Claim failed");
            (err as any).status = claimRes.status;
            throw err;
          }

          const mintTx = claimData.mint_tx_hash && claimData.mint_tx_hash !== "ALREADY_CLAIMED_ON_CHAIN" ? claimData.mint_tx_hash : burnHash;
          setMintHash(mintTx);

          // Real backend verification transition:
          // 1. Iris attestation signature was successfully verified by relayer -> complete "attestation"
          // 2. Activate "mint" milestone to show real on-chain claim submission before finalizing
          set(activateMilestone(completeMilestone(ms, "attestation"), "mint"));
          await new Promise((r) => setTimeout(r, 1500));

          // 3. Mark minting complete with actual destination transaction hash
          set(completeMilestone(completeMilestone(ms, "attestation"), "mint", mintTx));
          setTotalMs(nowMs() - startTimeRef.current);
          setState("success");

          saveTxHistory({ id: burnHash, txHash: burnHash, burnHash: burnHash, mintHash: mintTx, type: "bridge_cctp", status: "success", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: address });
          clearHistoryCache(address);
          return;
        }

        if (sourceChain.includes("Stellar") && !destChain.includes("Stellar")) {
          // ═══════════════════════════════════════════════════════════════════
          // NATIVE STELLAR -> EVM FLOW
          // ═══════════════════════════════════════════════════════════════════
          const activeDomains = getCctpDomains(isMainnetChain(sourceChain) || isMainnetChain(destChain) ? "mainnet" : "testnet");
          const destDomain = activeDomains[destChain] || resolveCctpDomain(destChain, isMainnetChain(destChain) ? "mainnet" : "testnet");
          if (!destDomain) throw new Error("CCTP configuration missing for destination");
          if (!params.destAddress) throw new Error("Destination address required");
          if (!stellarWallet.isConnected || !stellarWallet.address) {
            throw new Error("Stellar wallet not connected. Please connect Freighter.");
          }
          set(completeMilestone(activateMilestone(ms, "burn"), "appr"));

          // Amount is already properly scaled in formattedAmount -> parseUnits.
          // Stellar USDC expects 7-decimals in the contract parameter (handled properly by passing raw).
          // We pass the exact amount as string.
          const amountStellarUnits = amount.toString();

          const burnHash = await StellarClient.submitBurn(
            amountStellarUnits,
            destDomain.domain,
            params.destAddress,
            stellarWallet.address,
            stellarWallet.signTransaction
          );

          localBurnTx = burnHash;
          setBurnHash(burnHash);
          setTxHash(burnHash);

          // Complete burn and start attestation
          set(completeMilestone(activateMilestone(ms, "attestation"), "burn", burnHash));
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token || "";

          saveTxHistory({ id: burnHash, txHash: burnHash, burnHash: burnHash, mintHash: undefined, type: "bridge_cctp", status: "pending", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: address });

          // Sync transaction with backend before claiming
          await syncBridgeWithRetry({
            wallet_address: address,
            source_chain: sourceChain,
            destination_chain: destChain,
            token_symbol: fromAsset,
            amount: formattedAmount,
            burn_tx_hash: burnHash
          }, token);

          let claimRes: any;
          let claimData: any;
          for (let attempt = 0; attempt < 25; attempt++) {
            try {
              claimRes = await fetch('/api/bridge/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                  burn_tx_hash: burnHash,
                  source_chain: sourceChain,
                  destination_chain: destChain,
                  wallet_address: address,
                  amount: formattedAmount,
                  manual_claim: manualClaim
                })
              });
              claimData = await claimRes.json();
              if (claimData?.status === "MANUAL_CLAIM_REQUIRED" || claimData?.code === "RELAYER_LOW_GAS" || (manualClaim && (claimData?.message || claimData?.status === "READY_TO_CLAIM"))) {
                clearEngineIntervals();
                const claimPayload = {
                  message: claimData.message,
                  attestation: claimData.attestation,
                  destinationDomain: claimData.destination_domain,
                  destChain,
                  burnHash
                };
                setManualClaimPayload(claimPayload);

                const isSolana = destChain.toLowerCase().includes("solana");
                if (isSolana) {
                  set(completeMilestone(activateMilestone(ms, "mint"), "attestation"));
                  setState("running");
                  setError(manualClaim ? "Self-mint in progress. Please confirm the mint transaction in your destination wallet." : null);
                  setTimeout(() => {
                    executeManualClaim(claimPayload);
                  }, 150);
                  return;
                }

                set(completeMilestone(activateMilestone(ms, "mint"), "attestation"));
                setError(claimData.error || claimData.reason || "Self-mint enabled. Complete your claim below using your destination wallet.");
                setState("claim_manual_required");
                return;
              }
              if (claimRes.ok && claimData.success) break;
              if (claimRes.status === 409) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              break;
            } catch (fetchErr: any) {
              if (fetchErr && fetchErr.message && fetchErr.message.includes('Failed to fetch')) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              throw fetchErr;
            }
          }
          if (!claimRes || !claimData) throw new Error("Network timeout while claiming");
          if (!claimRes.ok) {
            const err = new Error(claimData.error || "Claim failed");
            (err as any).status = claimRes.status;
            throw err;
          }

          const mintTx = claimData.mint_tx_hash && claimData.mint_tx_hash !== "ALREADY_CLAIMED_ON_CHAIN" ? claimData.mint_tx_hash : burnHash;
          setMintHash(mintTx);

          // Real backend verification transition:
          // 1. Iris attestation signature was successfully verified by relayer -> complete "attestation"
          // 2. Activate "mint" milestone to show real on-chain claim submission before finalizing
          set(activateMilestone(completeMilestone(ms, "attestation"), "mint"));
          await new Promise((r) => setTimeout(r, 1500));

          // 3. Mark minting complete with actual destination transaction hash
          set(completeMilestone(completeMilestone(ms, "attestation"), "mint", mintTx));
          setTotalMs(nowMs() - startTimeRef.current);
          setState("success");

          saveTxHistory({ id: burnHash, txHash: burnHash, burnHash: burnHash, mintHash: mintTx, type: "bridge_cctp", status: "success", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: address });
          clearHistoryCache(address);
          return;
        }

        if (sourceChain.includes("Sui") && !destChain.includes("Sui")) {
          // ═══════════════════════════════════════════════════════════════════
          // NATIVE SUI -> DESTINATION FLOW
          // ═══════════════════════════════════════════════════════════════════
          const activeDomains = getCctpDomains(isMainnetChain(sourceChain) || isMainnetChain(destChain) ? "mainnet" : "testnet");
          const destDomain = activeDomains[destChain] || resolveCctpDomain(destChain, isMainnetChain(destChain) ? "mainnet" : "testnet");
          if (!destDomain) throw new Error("CCTP configuration missing for destination");
          if (!params.destAddress) throw new Error("Destination address required");
          if (!suiWallet.isConnected || !suiWallet.address) {
            throw new Error("Sui wallet not connected. Please connect your Sui wallet (e.g. Slush, Sui Wallet).");
          }
          set(completeMilestone(activateMilestone(ms, "burn"), "appr"));

          const isMainnet = isMainnetChain(sourceChain) || isMainnetChain(destChain);
          const suiConfig = getSuiCctpConfig(isMainnet);
          const usdcCoinType = suiConfig.usdcCoinType;

          const rawAmountBigInt = BigInt(Math.floor(parseFloat(formattedAmount) * 1_000_000));
          if (rawAmountBigInt <= 0n) throw new Error("Invalid amount");

          // ─────────────────────────────────────────────────────────────────────
          // Fetch USDC coin objects via Sui GraphQL.
          // USDC in most wallets lives as Coin objects, not SIP-58 address balance.
          // The correct GraphQL query: objects(filter:{type: "0x2::coin::Coin<USDC>"})
          // Confirmed working by live schema introspection — 'coins' field does not
          // exist on Address type in this schema version.
          // ─────────────────────────────────────────────────────────────────────
          const suiGqlEndpoint = isMainnet
            ? "https://graphql.mainnet.sui.io/graphql"
            : "https://graphql.testnet.sui.io/graphql";

          // Coin objects are typed as 0x2::coin::Coin<USDC_TYPE>
          const wrappedCoinType = `0x0000000000000000000000000000000000000000000000000000000000000002::coin::Coin<${usdcCoinType}>`;

          const coinGqlRes = await fetch(suiGqlEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `query GetCoinObjects($addr: SuiAddress!, $type: String!) {
                address(address: $addr) {
                  objects(filter: { type: $type }) {
                    nodes { address version }
                  }
                }
              }`,
              variables: { addr: suiWallet.address, type: wrappedCoinType }
            })
          });
          if (!coinGqlRes.ok) throw new Error(`Sui GraphQL fetch failed: ${coinGqlRes.status}`);
          const coinGqlData = await coinGqlRes.json();
          const coinNodes: Array<{ address: string; version: number }> =
            coinGqlData?.data?.address?.objects?.nodes ?? [];

          if (coinNodes.length === 0) {
            throw new Error(
              "No USDC coin objects found in Sui wallet. " +
              "Please ensure you have testnet USDC from https://faucet.circle.com (select Sui Testnet)."
            );
          }

          const tx = new Transaction();
          const primaryCoinId = coinNodes[0].address;

          // Merge all coin objects into one before splitting
          if (coinNodes.length > 1) {
            tx.mergeCoins(
              tx.object(primaryCoinId),
              coinNodes.slice(1).map(c => tx.object(c.address))
            );
          }

          // Split exact burn amount from the primary coin
          const [usdcToBurn] = tx.splitCoins(tx.object(primaryCoinId), [tx.pure.u64(rawAmountBigInt)]);

          // Circle CCTP V2 burn PTB on Sui
          let paddedRecipient: `0x${string}`;
          if (destChain.includes("Solana")) {
            const walletPubKey = new PublicKey(params.destAddress);
            const usdcMintPubKey = new PublicKey(
              isMainnet ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
            );
            const tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
            const ataProgramId = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
            const [ataPubKey] = PublicKey.findProgramAddressSync(
              [walletPubKey.toBuffer(), tokenProgramId.toBuffer(), usdcMintPubKey.toBuffer()],
              ataProgramId
            );
            paddedRecipient = ("0x" + Buffer.from(ataPubKey.toBytes()).toString("hex")) as `0x${string}`;
          } else {
            paddedRecipient = padAddressToBytes32(params.destAddress);
          }

          // 1. deposit_for_burn on TokenMessengerMinterV2
          const [burnReceipt, returnedCoin] = tx.moveCall({
            target: `${suiConfig.tmmV2PackageId}::deposit_for_burn::deposit_for_burn`,
            arguments: [
              usdcToBurn,
              tx.pure.u32(destDomain.domain),
              tx.pure.address(paddedRecipient),
              tx.pure.address("0x0"), // destinationCaller (0x0 = anyone can relay)
              tx.pure.u256(0n),       // maxFee
              tx.pure.u32(2000),      // minFinalityThreshold: 2000 = Standard Transfer
              tx.pure.vector("u8", []), // hookData (empty)
              tx.object(suiConfig.tmmV2StateId),
            ],
            typeArguments: [usdcCoinType],
          });

          // 2. handler::burn on StablecoinHandler
          const [completeBurnTicket] = tx.moveCall({
            target: `${suiConfig.handlerPackageId}::handler::burn`,
            arguments: [
              tx.object(suiConfig.handlerStateId),
              burnReceipt,
              returnedCoin,
              tx.object(suiConfig.denyListId), // 0x403
              tx.object(suiConfig.treasuryId),
            ],
          });

          // 3. complete_burn on TokenMessengerMinterV2
          tx.moveCall({
            target: `${suiConfig.tmmV2PackageId}::deposit_for_burn::complete_burn`,
            arguments: [
              completeBurnTicket,
              tx.object(suiConfig.tmmV2StateId),
              tx.object(suiConfig.mtV2StateId),
            ],
            typeArguments: [
              usdcCoinType,
              `${suiConfig.handlerPackageId}::handler::Auth`,
            ],
          });

          const grpcClient = new SuiGrpcClient({
            baseUrl: isMainnet ? "https://fullnode.mainnet.sui.io:443" : "https://fullnode.testnet.sui.io:443",
            network: isMainnet ? "mainnet" : "testnet",
          });

          tx.setSender(suiWallet.address);
          await tx.build({ client: grpcClient });

          const { bytes, signature } = await signSuiTx({ transaction: tx });

          const response = await grpcClient.executeTransaction({
            transaction: fromBase64(bytes),
            signatures: [signature],
          });

          if (response.FailedTransaction) {
            const errDetail = (response.FailedTransaction.status as any)?.error?.message || "Sui transaction failed on-chain";
            throw new Error(`Sui transaction failed: ${errDetail}`);
          }
          const burnHash = response.Transaction?.digest || (response as any).digest;

          localBurnTx = burnHash;
          setBurnHash(burnHash);
          setTxHash(burnHash);

          // Complete burn and start attestation
          set(completeMilestone(activateMilestone(ms, "attestation"), "burn", burnHash));
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token || "";

          saveTxHistory({ id: burnHash, txHash: burnHash, burnHash: burnHash, mintHash: undefined, type: "bridge_cctp", status: "pending", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: suiWallet.address });

          await syncBridgeWithRetry({
            wallet_address: params.destAddress || evmAddress || suiWallet.address,
            source_chain: sourceChain,
            destination_chain: destChain,
            token_symbol: fromAsset,
            amount: formattedAmount,
            burn_tx_hash: burnHash,
            source_address: suiWallet.address
          }, token);

          let claimRes: any;
          let claimData: any;
          for (let attempt = 0; attempt < 25; attempt++) {
            try {
              claimRes = await fetch('/api/bridge/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                  burn_tx_hash: burnHash,
                  source_chain: sourceChain,
                  destination_chain: destChain,
                  wallet_address: suiWallet.address,
                  amount: formattedAmount
                })
              });
              claimData = await claimRes.json();
              if (claimRes.ok && claimData.success) break;
              if (claimRes.status === 409) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              break;
            } catch (fetchErr: any) {
              if (fetchErr && fetchErr.message && fetchErr.message.includes('Failed to fetch')) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              throw fetchErr;
            }
          }
          if (!claimRes || !claimData) throw new Error("Network timeout while claiming");
          if (!claimRes.ok) {
            const err = new Error(claimData.error || "Claim failed");
            (err as any).status = claimRes.status;
            throw err;
          }

          const mintTx = claimData.mint_tx_hash && claimData.mint_tx_hash !== "ALREADY_CLAIMED_ON_CHAIN" ? claimData.mint_tx_hash : burnHash;
          setMintHash(mintTx);

          // Real backend verification transition:
          // 1. Iris attestation signature was successfully verified by relayer -> complete "attestation"
          // 2. Activate "mint" milestone to show real on-chain claim submission before finalizing
          set(activateMilestone(completeMilestone(ms, "attestation"), "mint"));
          await new Promise((r) => setTimeout(r, 1500));

          // 3. Mark minting complete with actual destination transaction hash
          set(completeMilestone(completeMilestone(ms, "attestation"), "mint", mintTx));
          setTotalMs(nowMs() - startTimeRef.current);
          setState("success");

          saveTxHistory({ id: burnHash, txHash: burnHash, burnHash: burnHash, mintHash: mintTx, type: "bridge_cctp", status: "success", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: suiWallet.address });
          clearHistoryCache(suiWallet.address);
          return;
        }

        const getDestAddressVal = (chainName: string) => {
          if (chainName.includes("Solana")) return solanaWallet?.publicKey?.toBase58() || "";
          if (chainName.includes("Stellar")) return stellarWallet?.address || "";
          if (chainName.includes("Sui")) return suiWallet?.address || "";
          return evmAddress || "";
        };
        const destAddressVal = params.destAddress || getDestAddressVal(destChain);

        const isAppKitChain = (chainName: string) => {
          const formatMap: Record<string, string> = {
            "Base Mainnet": "Base",
            "Arbitrum Mainnet": "Arbitrum",
            "Ethereum Mainnet": "Ethereum",
            "OP Mainnet": "Optimism",
            "Polygon Mainnet": "Polygon",
            "Avalanche Mainnet": "Avalanche",
            "Sonic Mainnet": "Sonic",
            "Ink Mainnet": "Ink",
            "Unichain Mainnet": "Unichain",
            "Linea Mainnet": "Linea",
            "Ink Sepolia": "Ink_Testnet",
            "Injective EVM Testnet": "Injective_Testnet"
          };
          const formatted = formatMap[chainName] || chainName.replaceAll(" ", "_");
          const supported = getKit().getSupportedChains().map((c: any) => c.chain);
          return supported.includes(formatted);
        };

        // Get the live, raw provider from the connector to avoid stale Viem transport pinning bugs
        const rawProvider = connector ? await connector.getProvider() : undefined;

        relayerInterceptedProvider = rawProvider ? new Proxy(rawProvider as any, {
          get: (target, prop, receiver) => {
            if (prop === 'request') {
              return async (args: any) => {
                if (!isBridgeActiveRef.current && args?.method === 'eth_sendTransaction') throw new Error("FLOW_TERMINATED");

                const txParams = args.params?.[0];
                const txData = txParams?.data || "";
                const isApproveTx = typeof txData === 'string' && txData.startsWith("0x095ea7b3");
                const isBurnTx = args?.method === 'eth_sendTransaction' && !isApproveTx && !localBurnTx;

                // Intercept destination chain switch prompts after burn succeeds
                if (localBurnTx && args?.method === 'wallet_switchEthereumChain') {
                  console.log("[SingleExecutor] Intercepted and bypassed wallet network switch to destination chain.");
                  return null;
                }
                if (localBurnTx && args?.method === 'eth_chainId') {
                  const destChainConfig = ChainRegistry.getChainSafe(destChain);
                  const destChainId = destChainConfig ? destChainConfig.chainId : null;
                  if (destChainId) {
                    const destChainIdHex = '0x' + destChainId.toString(16);
                    console.log(`[SingleExecutor] Mocked eth_chainId to ${destChainIdHex}`);
                    return destChainIdHex;
                  }
                }
                if (localBurnTx && args?.method === 'net_version') {
                  const destChainConfig = ChainRegistry.getChainSafe(destChain);
                  const destChainId = destChainConfig ? destChainConfig.chainId : null;
                  if (destChainId) {
                    console.log(`[SingleExecutor] Mocked net_version to ${destChainId}`);
                    return destChainId.toString();
                  }
                }

                if (sourceChainConfig?.chainId === 80002 && typeof args?.method === 'string' && args.method !== 'eth_sendTransaction' && !args.method.startsWith('wallet_')) {
                  try {
                    const res = await fetch("https://rpc-amoy.polygon.technology", {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: Date.now(),
                        method: args.method,
                        params: args.params || []
                      })
                    });
                    const data = await res.json();
                    if (data && typeof data === 'object' && !data.error && data.result !== undefined) {
                      return data.result;
                    }
                  } catch (proxyErr: any) {
                    console.warn(`[TxEngine] Polygon Amoy Alchemy RPC proxy fallback for ${args.method}:`, proxyErr);
                  }
                }

                if (args?.method === 'eth_sendTransaction' && args.params?.[0]) {
                  const txParams = args.params[0];
                  const srcChainId = sourceChainConfig?.chainId;

                  if (srcChainId === 1439) {
                    console.log("[TxEngine] Injective EVM Testnet detected — applying 10 Gwei gas price boost.");
                    txParams.gasPrice = "0x2540BE400";
                    delete txParams.maxFeePerGas;
                    delete txParams.maxPriorityFeePerGas;
                  } else if (srcChainId === 998) {
                    txParams.gasPrice = "0x77359400";
                    delete txParams.maxFeePerGas;
                    delete txParams.maxPriorityFeePerGas;
                  } else if (srcChainId === 80002) {
                    console.log("[TxEngine] Polygon Amoy Testnet detected — applying 35 Gwei gas price boost.");
                    txParams.gasPrice = "0x826299E00";
                    delete txParams.maxFeePerGas;
                    delete txParams.maxPriorityFeePerGas;
                  }
                }

                if (localBurnTx && args?.method === 'eth_sendTransaction') {
                  console.log(`[SingleExecutor] Intercepted destination wallet transaction for burn ${localBurnTx}. Delegating to backend relayer...`);

                  const { data: sessionData } = await supabase.auth.getSession();
                  const token = sessionData.session?.access_token || "";

                  for (let attempt = 0; attempt < 30; attempt++) {
                    if (!isBridgeActiveRef.current) throw new Error("USER_CANCELLED");
                    try {
                      const claimRes = await fetch('/api/bridge/claim', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ burn_tx_hash: localBurnTx })
                      });
                      const claimData = await claimRes.json();
                      if (claimData.status === "MANUAL_CLAIM_REQUIRED" || claimData.code === "RELAYER_LOW_GAS") {
                        console.warn(`[SingleExecutor] Relayer out of gas for ${localBurnTx}. Stopping auto-poller and enabling manual fallback.`);
                        setManualClaimPayload({
                          message: claimData.message,
                          attestation: claimData.attestation,
                          destinationDomain: claimData.destination_domain,
                          destChain,
                          burnHash: localBurnTx
                        });
                        throw new Error("MANUAL_CLAIM_REQUIRED");
                      }
                      if (claimRes.ok && claimData.success) {
                        const finalMintHash = claimData.mint_tx_hash && claimData.mint_tx_hash !== "ALREADY_CLAIMED_ON_CHAIN"
                          ? claimData.mint_tx_hash
                          : "";
                        if (finalMintHash) {
                          return finalMintHash;
                        }
                      }
                    } catch (err: any) {
                      if (err?.message === "MANUAL_CLAIM_REQUIRED" || String(err).includes("MANUAL_CLAIM_REQUIRED")) {
                        throw err;
                      }
                    }
                    await new Promise(r => setTimeout(r, 6000));
                  }
                }

                const res = await target.request(args);
                return res;
              };
            }

            const value = Reflect.get(target, prop, receiver);
            return typeof value === 'function' ? value.bind(target) : value;
          }
        }) : undefined;

        const resolveAdapter = async (chainName: string) => {
          if (chainName.toLowerCase().includes("solana")) {
            if (!solanaWallet || !solanaWallet.publicKey) throw new Error("Solana wallet not connected.");
            const provider = solanaWallet.wallet?.adapter || solanaWallet;

            const handleSolanaSignature = (signature: string) => {
              if (localBurnTx) return;
              localBurnTx = signature;
              setBurnHash(signature);
              setTxHash(signature);
              console.log("[SolanaInterceptor] Captured Solana burn signature:", signature);

              setMilestones((prev) => {
                let next = completeMilestone(prev, "appr");
                next = completeMilestone(next, "burn", signature);
                next = activateMilestone(next, "attestation");
                return next;
              });
              setState("pending");
              isBridgeActiveRef.current = false;

              fetch('/api/bridge/sync', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  wallet_address: address,
                  source_chain: sourceChain,
                  destination_chain: destChain,
                  token_symbol: fromAsset,
                  amount: formattedAmount,
                  burn_tx_hash: signature,
                  source_address: solanaWallet.publicKey ? solanaWallet.publicKey.toBase58() : undefined
                })
              }).then((syncRes) => {
                if (syncRes.ok && !claimPollInterval && !isForceResolved) {
                  console.log("[SolanaInterceptor] Starting background claim polling for burn:", signature);
                  // Track whether last poll was attestation-pending (409) so timeout shows correct UI
                  let lastWasAttestationPending = false;
                  claimPollInterval = setInterval(async () => {
                    try {
                      const elapsed = nowMs() - startTimeRef.current;
                      // 10 minutes — Circle attestation normally takes 1-3 min, give plenty of room
                      if (elapsed > 600000) {
                        console.warn("[CLAIM_TIMEOUT] Relayer claim taking longer than expected.", lastWasAttestationPending ? "Attestation still pending." : "Enabling manual claim.");
                        isForceResolved = true;
                        if (claimPollInterval) clearInterval(claimPollInterval);
                        if (lastWasAttestationPending) {
                          // Circle Iris still hasn't attested — show the proper waiting UI, not manual claim
                          console.log("[CLAIM_TIMEOUT] Last poll was attestation-pending. Setting attestation_pending state.");
                          setMilestones((prev) => {
                            let next = completeMilestone(prev, "appr");
                            next = completeMilestone(next, "burn", signature);
                            next = activateMilestone(next, "attestation");
                            return next;
                          });
                          setState("attestation_pending");
                        } else {
                          setError("Attestation verification is taking a bit long. You can claim it manually below or wait for background sync.");
                          setState("claim_manual_required");
                        }
                        return;
                      }

                      const claimRes = await fetch('/api/bridge/claim', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ burn_tx_hash: signature })
                      });

                      if (claimRes.status === 409) {
                        // Circle Iris attestation not yet available — keep polling
                        lastWasAttestationPending = true;
                        console.log("[CLAIM_POLL] Solana: Circle Iris attestation pending (HTTP 409). Continuing background polling...");
                        setMilestones((prev) => activateMilestone(prev, "attestation"));
                        return;
                      }

                      lastWasAttestationPending = false;

                      if (claimRes.ok) {
                        const json = await claimRes.json();
                        if (json.status === "MANUAL_CLAIM_REQUIRED" || json.code === "RELAYER_LOW_GAS") {
                          isForceResolved = true;
                          if (claimPollInterval) clearInterval(claimPollInterval);
                          setError("Our relayer is temporarily low on gas. Claim manually.");
                          setState("claim_manual_required");
                        } else if (json.success && !isForceResolved) {
                          isForceResolved = true;
                          if (claimPollInterval) clearInterval(claimPollInterval);
                          const finalMintHash = json.mint_tx_hash && json.mint_tx_hash !== "ALREADY_CLAIMED_ON_CHAIN" ? json.mint_tx_hash : signature;
                          setMintHash(finalMintHash);
                          setMilestones((prev) => {
                            let next = completeMilestone(prev, "appr");
                            next = completeMilestone(next, "burn", signature);
                            next = completeMilestone(next, "attestation");
                            next = activateMilestone(next, "mint");
                            next = completeMilestone(next, "mint", finalMintHash);
                            return next;
                          });
                          setTotalMs(nowMs() - startTimeRef.current);
                          setState("success");
                          clearHistoryCache(address);
                        }
                      }
                    } catch (_) { }
                  }, 3000);
                }
              }).catch(err => console.error("API bridge sync error:", err));
            };

            const interceptedProvider = new Proxy(provider, {
              get(target, prop, receiver) {
                if (prop === 'sendTransaction' || prop === 'signAndSendTransaction' || prop === 'signTransaction' || prop === 'signAllTransactions') {
                  return async (...args: any[]) => {
                    if (localBurnTx) {
                      console.log(`[SingleExecutor] Intercepted Solana wallet method '${String(prop)}' for burn ${localBurnTx}. Delegating to backend relayer...`);

                      const { data: sessionData } = await supabase.auth.getSession();
                      const token = sessionData.session?.access_token || "";

                      for (let attempt = 0; attempt < 35; attempt++) {
                        if (!isBridgeActiveRef.current) throw new Error("FLOW_TERMINATED");
                        try {
                          const claimRes = await fetch('/api/bridge/claim', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({
                              burn_tx_hash: localBurnTx,
                              source_chain: sourceChain,
                              destination_chain: destChain,
                              wallet_address: address,
                              amount: formattedAmount
                            })
                          });
                          const claimData = await claimRes.json();
                          if (claimData.status === "MANUAL_CLAIM_REQUIRED" || claimData.code === "RELAYER_LOW_GAS") {
                            console.warn(`[SingleExecutor] Relayer out of gas for ${localBurnTx}. Stopping auto-poller and enabling manual fallback.`);
                            setManualClaimPayload({
                              message: claimData.message,
                              attestation: claimData.attestation,
                              destinationDomain: claimData.destination_domain,
                              destChain,
                              burnHash: localBurnTx
                            });
                            throw new Error("MANUAL_CLAIM_REQUIRED");
                          }
                          if (claimRes.ok && claimData.success) {
                            const finalMintHash = claimData.mint_tx_hash && claimData.mint_tx_hash !== "ALREADY_CLAIMED_ON_CHAIN"
                              ? claimData.mint_tx_hash
                              : "";

                            if (finalMintHash) {
                              isForceResolved = true;
                              if (claimPollInterval) clearInterval(claimPollInterval);
                              if (backgroundPollInterval) clearInterval(backgroundPollInterval);

                              setMintHash(finalMintHash);
                              setMilestones((prev) => {
                                let next = completeMilestone(prev, "appr");
                                next = completeMilestone(next, "burn", localBurnTx || undefined);
                                next = completeMilestone(next, "attestation");
                                next = activateMilestone(next, "mint");
                                next = completeMilestone(next, "mint", finalMintHash);
                                return next;
                              });
                              setTotalMs(nowMs() - startTimeRef.current);
                              setState("success");
                              clearHistoryCache(address);
                              return finalMintHash;
                            }
                          }
                        } catch (err: any) {
                          if (err?.message === "FLOW_TERMINATED" || err?.message === "MANUAL_CLAIM_REQUIRED" || String(err).includes("FLOW_TERMINATED") || String(err).includes("MANUAL_CLAIM_REQUIRED")) {
                            throw err;
                          }
                        }
                        await new Promise(r => setTimeout(r, 3000));
                      }
                      throw new Error("FLOW_TERMINATED");
                    }

                    if (prop === 'sendTransaction') {
                      const signature = await (target as any).sendTransaction(...args);
                      handleSolanaSignature(signature);
                      return signature;
                    } else if (prop === 'signAndSendTransaction') {
                      const result = await (target as any).signAndSendTransaction(...args);
                      const signature = typeof result === 'string' ? result : result?.signature;
                      if (signature) handleSolanaSignature(signature);
                      return result;
                    } else {
                      const value = Reflect.get(target, prop);
                      if (typeof value === 'function') {
                        const result = await value.apply(target, args);
                        if (prop === 'signTransaction' && result && typeof result === 'object') {
                          try {
                            const sigBytes = (result as any).signatures?.[0];
                            if (sigBytes) {
                              const signature = bs58.encode(sigBytes);
                              console.log("[SingleExecutor] Captured Solana signature from signTransaction:", signature);
                              setTimeout(() => {
                                handleSolanaSignature(signature);
                              }, 3000);
                            }
                          } catch (err) {
                            console.error("Failed to extract Solana signature from signTransaction:", err);
                          }
                        }
                        return result;
                      }
                      return value;
                    }
                  };
                }

                if (prop === 'isConnected' && (target as any).isConnected === undefined && (target as any).connected !== undefined) {
                  return (target as any).connected;
                }
                const value = Reflect.get(target, prop);
                return typeof value === 'function' ? value.bind(target) : value;
              }
            });

            const targetChain = chainName.includes("Devnet") ? SolanaDevnet : Solana;
            const rawAdapter = await createSolanaAdapterFromProvider({
              provider: interceptedProvider as any,
              capabilities: { supportedChains: [targetChain] }
            });

            return new Proxy(rawAdapter, {
              get(target, prop, receiver) {
                if (prop === 'prepareAction') {
                  return async (action: any, params: any, context: any) => {
                    console.log(`[AdapterProxy] Intercepted prepareAction '${action}' on Solana adapter. Original params:`, params);
                    if (action === 'cctp.v2.depositForBurn' || action === 'cctp.v2.depositForBurnWithHook') {
                      if (params) {
                        params.destinationCaller = "0x0000000000000000000000000000000000000000";
                        console.log(`[AdapterProxy] Overrode destinationCaller to zero address:`, params.destinationCaller);
                      }
                    }
                    return await target.prepareAction(action, params, context);
                  };
                }
                const value = Reflect.get(target, prop);
                return typeof value === 'function' ? value.bind(target) : value;
              }
            });
          } else {
            if (!rawProvider) throw new Error("EVM wallet provider not found.");

            const CHAIN_RPC_OVERRIDES: Record<number, string[]> = {
              1439: [
                "https://k8s.testnet.json-rpc.injective.network/",
                "https://injectiveevm-testnet-rpc.polkachu.com"
              ],
              10143: [
                process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz",
                "https://testnet-rpc.monad.xyz",
                "https://monad-testnet-rpc.g.allthatnode.com/default",
                "https://rpc-devnet.monad.xyz"
              ],
            };

            return await createViemAdapterFromProvider({
              provider: relayerInterceptedProvider,
              // @ts-ignore - Viem v1/v2 PublicClient mismatch with adapter
              getPublicClient: ({ chain }: any) => {
                let transport;
                if (chain.id === 5042002) {
                  const wrappedHttp = (url: string, opts: any) => {
                    const base = http(url, opts);
                    return (cOpts: any) => {
                      const client = base(cOpts);
                      return {
                        ...client,
                        request: async (args: any) => {
                          if (!isBridgeActiveRef.current && args?.method === 'eth_sendTransaction') throw new Error("FLOW_TERMINATED");
                          return await client.request(args);
                        }
                      } as any;
                    };
                  };
                  transport = fallback([
                    wrappedHttp(process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com", { retryCount: 2, retryDelay: 500, batch: true }),
                    wrappedHttp("https://5042002.rpc.thirdweb.com", { retryCount: 2, retryDelay: 500, batch: true })
                  ]);
                } else {
                  const defaultRpc = chain.rpcEndpoints?.[0] ?? chain.rpcUrls?.default?.http?.[0] ?? "NO_RPC";
                  const rpcs = CHAIN_RPC_OVERRIDES[chain.id] ?? [defaultRpc];
                  const isBatchSupported = chain.id !== 1439;
                  const wrappedHttp = (url: string) => {
                    const base = http(url, { retryCount: 5, retryDelay: 1000, batch: isBatchSupported });
                    return (cOpts: any) => {
                      const client = base(cOpts);
                      return {
                        ...client,
                        request: async (args: any) => {
                          if (!isBridgeActiveRef.current && args?.method === 'eth_sendTransaction') throw new Error("FLOW_TERMINATED");
                          return await client.request(args);
                        }
                      } as any;
                    };
                  };
                  transport = fallback(rpcs.map(wrappedHttp));
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
                supportedChains: getKit().getSupportedChains().filter((c: any) => c.type === "evm") as any,
              },
            });
          }
        };

        if ((fromAsset === "EURC" || fromAsset === "cirBTC" || !isAppKitChain(sourceChain) || !isAppKitChain(destChain) || destChain.includes("Solana")) && !sourceChain.includes("Solana") && !sourceChain.includes("Stellar") && !sourceChain.includes("Sui")) {
          // ══════════════════════════════════════════════════════════════════════
          // DIRECT NATIVE EVM CCTP BURN FLOW (For X Layer Testnet & custom chains)
          // ══════════════════════════════════════════════════════════════════════
          const activeDomains = getCctpDomains(isMainnetChain(sourceChain) || isMainnetChain(destChain) ? "mainnet" : "testnet");
          const sourceDomain = activeDomains[sourceChain] || resolveCctpDomain(sourceChain, isMainnetChain(sourceChain) ? "mainnet" : "testnet");
          const destDomain = activeDomains[destChain] || resolveCctpDomain(destChain, isMainnetChain(destChain) ? "mainnet" : "testnet");
          if (!sourceDomain) throw new Error(`CCTP configuration missing for source chain: ${sourceChain}`);
          if (!destDomain) throw new Error(`CCTP configuration missing for destination chain: ${destChain}`);

          const zero32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
          let mintRecipient: `0x${string}`;
          let burnHash: `0x${string}`;

          if (fromAsset === "EURC" || fromAsset === "cirBTC") {
            const isCirBtc = fromAsset === "cirBTC";
            const SUPPORTED_CHAINS = isCirBtc
              ? ["Arc Testnet", "Ethereum Sepolia"]
              : ["Arc Testnet", "Base Sepolia", "Ethereum Sepolia", "Avalanche Fuji"];
            const isSupportedRoute =
              SUPPORTED_CHAINS.includes(sourceChain as string) &&
              SUPPORTED_CHAINS.includes(destChain as string) &&
              sourceChain !== destChain;

            if (!isSupportedRoute) {
              throw new Error(`${fromAsset} CCTP bridge is supported across ${SUPPORTED_CHAINS.join(", ")}.`);
            }

            const tokenAddress = isCirBtc
              ? (((sourceDomain as any)?.cirBtc || (sourceChain === "Arc Testnet" ? "0xf0c4a4ce82a5746abaad9425360ab04fbba432bf" : "0x3a3fe695f684bf9b9e43cf43c2b895ea5e392bb3")) as `0x${string}`)
              : (((sourceDomain as any)?.eurc || (
                sourceChain === "Arc Testnet"
                  ? "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a"
                  : sourceChain === "Base Sepolia"
                  ? "0x808456652fdb597867f38412077A9182bf77359F"
                  : sourceChain === "Ethereum Sepolia"
                  ? "0x08210F9170F89Ab7658F0B5E3fF39b0E03C594D4"
                  : "0x5E44db7996c682E92a960b65AC713a54AD815c6B"
              )) as `0x${string}`);
            const tokenManager = isCirBtc ? CIRBTC_TOKEN_MANAGER_ADDRESS : CCTS_TOKEN_MANAGER_ADDRESS;
            const cctpxTokenId = isCirBtc ? CIRBTC_TOKEN_ID : EURC_TOKEN_ID;

            let liveAllowance = 0n;
            try {
              liveAllowance = await publicClient.readContract({
                address: tokenAddress,
                abi: ERC20_APPROVE_ABI,
                functionName: "allowance",
                args: [evmAddress as `0x${string}`, tokenManager as `0x${string}`],
              }) as bigint;
            } catch (_) {}

            if (amount > liveAllowance) {
              set(activateMilestone(ms, "appr"));
              const apprTx = await writeContractAsync({
                chainId: sourceChainConfig?.chainId,
                address: tokenAddress,
                abi: ERC20_APPROVE_ABI,
                functionName: "approve",
                args: [tokenManager as any, amount],
              });

              const apprReceipt = await publicClient.waitForTransactionReceipt({ hash: apprTx });
              if (apprReceipt.status !== "success") {
                throw new Error(`${fromAsset} approval reverted on-chain.`);
              }
              set(completeMilestone(activateMilestone(ms, "burn"), "appr", apprTx));
            } else {
              set(completeMilestone(activateMilestone(ms, "burn"), "appr"));
            }

            // Fetch quote from Circle Iris for CCTPx
            const irisBase = process.env.NEXT_PUBLIC_CIRCLE_IRIS_API_URL || "https://iris-api-sandbox.circle.com";
            const quoteRes = await fetch(`${irisBase}/v2/quote/cctpx/${cctpxTokenId}/${sourceDomain.domain}/${destDomain.domain}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                amount: amount.toString(),
                feeToken: zeroAddress,
                requests: [{ type: "PRE_FINALITY" }],
              }),
            });

            if (!quoteRes.ok) {
              const errText = await quoteRes.text();
              throw new Error(`Failed to fetch ${fromAsset} fee quote from Circle Iris: ${errText}`);
            }

            const quote = await quoteRes.json();
            const claim = {
              signedQuote: quote.signedQuote as `0x${string}`,
              refundAddress: zeroAddress,
            };
            const feeValue = BigInt(quote.feeTotalAmount);
            const destinationAddress = encodePacked(["address"], [destAddressVal as `0x${string}`]);

            burnHash = await writeContractAsync({
              chainId: sourceChainConfig?.chainId,
              address: CROSS_CHAIN_TOKEN_SERVICE_ADDRESS,
              abi: CROSS_CHAIN_TOKEN_SERVICE_ABI,
              functionName: "crossChainTransfer",
              args: [
                cctpxTokenId,
                amount,
                destDomain.domain,
                destinationAddress,
                zero32,
                1000,
                claim,
                false,
                "0x",
              ],
              value: feeValue,
            });
          } else {
            const evmMaxFee = amount / 100n > 0n ? amount / 100n : 1n;
            const evmTotalApprove = amount + evmMaxFee;

            const activeMessenger = (sourceDomain.tokenMessenger || (isMainnetChain(sourceChain) ? "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" : "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA"));

            let liveAllowance = allowance;
            try {
              liveAllowance = await publicClient.readContract({
                address: sourceDomain.usdc as `0x${string}`,
                abi: ERC20_APPROVE_ABI,
                functionName: "allowance",
                args: [evmAddress as `0x${string}`, activeMessenger as `0x${string}`]
              }) as bigint;
            } catch (_) {}

            if (evmTotalApprove > liveAllowance) {
              set(activateMilestone(ms, "appr"));
              const apprTx = await writeContractAsync({
                chainId: sourceChainConfig?.chainId,
                address: sourceDomain.usdc as `0x${string}`,
                abi: ERC20_APPROVE_ABI,
                functionName: "approve",
                args: [activeMessenger as any, evmTotalApprove],
              });

              const apprReceipt = await publicClient.waitForTransactionReceipt({ hash: apprTx });
              if (apprReceipt.status !== "success") {
                throw new Error("Token approval reverted on-chain.");
              }
              set(completeMilestone(activateMilestone(ms, "burn"), "appr", apprTx));
            } else {
              set(completeMilestone(activateMilestone(ms, "burn"), "appr"));
            }

          if (destChain.includes("Solana")) {
            if (!destAddressVal) throw new Error("Destination Solana address required");
            const walletPubKey = new PublicKey(destAddressVal);
            const isMainnetSol = isMainnetChain(destChain) || isMainnetChain(sourceChain);
            const usdcMintPubKey = new PublicKey(
              isMainnetSol ? "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" : "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
            );
            const tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
            const ataProgramId = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
            const [ataPubKey] = PublicKey.findProgramAddressSync(
              [walletPubKey.toBuffer(), tokenProgramId.toBuffer(), usdcMintPubKey.toBuffer()],
              ataProgramId
            );
            mintRecipient = ("0x" + Buffer.from(ataPubKey.toBytes()).toString("hex")) as `0x${string}`;

            const finalityThreshold = isMainnetSol ? 2000 : 1000;
            const finalMaxFee = isMainnetSol ? 0n : evmMaxFee;

            burnHash = await writeContractAsync({
              chainId: sourceChainConfig?.chainId,
              address: sourceDomain.tokenMessenger as any,
              abi: TOKEN_MESSENGER_V2_ABI,
              functionName: "depositForBurn",
              args: [
                amount,
                destDomain.domain,
                mintRecipient,
                sourceDomain.usdc as `0x${string}`,
                zero32,
                finalMaxFee,
                finalityThreshold
              ],
            });
          } else if (destChain.includes("Stellar")) {
            if (!destAddressVal) throw new Error("Destination Stellar address required");
            if (!destDomain.cctpForwarder) throw new Error("CctpForwarder missing from Stellar domain config");
            const cctpForwarderRaw = StrKey.decodeContract(destDomain.cctpForwarder);
            mintRecipient = ("0x" + Buffer.from(cctpForwarderRaw).toString("hex")) as `0x${string}`;

            const strBytesHex = stringToHex(destAddressVal);
            const strBytesLength = destAddressVal.length;
            const versionHex = padHex("0x0", { size: 4 });
            const lengthHex = padHex(toHex(strBytesLength), { size: 4 });
            const padding24 = padHex("0x0", { size: 24 });
            const hookDataHex = concat([padding24, versionHex, lengthHex, strBytesHex]);

            burnHash = await writeContractAsync({
              chainId: sourceChainConfig?.chainId,
              address: sourceDomain.tokenMessenger as any,
              abi: TOKEN_MESSENGER_V2_ABI,
              functionName: "depositForBurnWithHook",
              args: [
                amount,
                destDomain.domain,
                mintRecipient,
                sourceDomain.usdc as `0x${string}`,
                mintRecipient,
                evmMaxFee,
                1000,
                hookDataHex as `0x${string}`
              ],
            });
          } else if (destChain.includes("Sui")) {
            if (!destAddressVal) throw new Error("Destination Sui address required");
            mintRecipient = padAddressToBytes32(destAddressVal);

            burnHash = await writeContractAsync({
              chainId: sourceChainConfig?.chainId,
              address: sourceDomain.tokenMessenger as any,
              abi: TOKEN_MESSENGER_V2_ABI,
              functionName: "depositForBurn",
              args: [
                amount,
                destDomain.domain,
                mintRecipient,
                sourceDomain.usdc as `0x${string}`,
                zero32,
                evmMaxFee,
                2000 // 2000 for Standard Transfer to Sui per Circle CCTP V2 docs
              ],
            });
          } else {
            // EVM destination
            if (!destAddressVal) throw new Error("Destination EVM address required");
            mintRecipient = padHex(destAddressVal as `0x${string}`, { size: 32 });

            // Standard finality threshold: 2000 for Arc Mainnet <-> Base Mainnet Standard transfer (0 maxFee)
            // or when standard transfer is explicitly configured; 1000 for testnets/fast transfers.
            const isMainnetTransfer = isMainnetChain(sourceChain) || isMainnetChain(destChain);
            const finalityThreshold = isMainnetTransfer ? 2000 : 1000;
            const finalMaxFee = isMainnetTransfer ? 0n : evmMaxFee;

            burnHash = await writeContractAsync({
              chainId: sourceChainConfig?.chainId,
              address: sourceDomain.tokenMessenger as any,
              abi: TOKEN_MESSENGER_V2_ABI,
              functionName: "depositForBurn",
              args: [
                amount,
                destDomain.domain,
                mintRecipient,
                sourceDomain.usdc as `0x${string}`,
                zero32,
                finalMaxFee,
                finalityThreshold
              ],
            });
          }
        }

          localBurnTx = burnHash;
          setBurnHash(burnHash);
          setTxHash(burnHash);

          // Wait for burn transaction confirmation on-chain before advancing milestone
          let burnReceipt;
          try {
            burnReceipt = await (publicClient?.waitForTransactionReceipt({ hash: burnHash }) ?? Promise.reject(new Error("No public client available")));
          } catch (waitErr) {
            const fallbackRpc = sourceChainSafe?.rpcUrl || (sourceDomain as any)?.rpcUrl;
            if (fallbackRpc) {
              const directClient = createPublicClient({ transport: http(fallbackRpc, { timeout: 8000 }) });
              burnReceipt = await directClient.waitForTransactionReceipt({ hash: burnHash });
            } else {
              throw waitErr;
            }
          }

          if (burnReceipt && burnReceipt.status !== "success") {
            throw new Error(`Burn transaction reverted on-chain on ${sourceChain}. Transaction status: failed.`);
          }

          // Complete burn and activate attestation
          set(completeMilestone(activateMilestone(ms, "attestation"), "burn", burnHash));
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token || "";

          saveTxHistory({ id: burnHash, txHash: burnHash, burnHash: burnHash, mintHash: undefined, type: "bridge_cctp", status: "pending", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: address });

          await syncBridgeWithRetry({
            wallet_address: address,
            source_chain: sourceChain,
            destination_chain: destChain,
            token_symbol: fromAsset,
            amount: formattedAmount,
            burn_tx_hash: burnHash,
            source_address: solanaWallet.publicKey ? solanaWallet.publicKey.toBase58() : undefined
          }, token);

          let claimRes: any;
          let claimData: any;
          for (let attempt = 0; attempt < 25; attempt++) {
            try {
              claimRes = await fetch('/api/bridge/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                  burn_tx_hash: burnHash,
                  source_chain: sourceChain,
                  destination_chain: destChain,
                  wallet_address: address,
                  amount: formattedAmount,
                  token_symbol: fromAsset || "USDC",
                  manual_claim: manualClaim
                })
              });
              claimData = await claimRes.json();
              if (claimData?.status === "MANUAL_CLAIM_REQUIRED" || claimData?.code === "RELAYER_LOW_GAS" || (manualClaim && claimData?.message)) {
                clearEngineIntervals();
                setManualClaimPayload({
                  message: claimData.message,
                  attestation: claimData.attestation,
                  destinationDomain: claimData.destination_domain,
                  destChain,
                  burnHash
                });
                const isSolana = destChain.toLowerCase().includes("solana");
                if (isSolana) {
                  set(completeMilestone(activateMilestone(ms, "mint"), "attestation"));
                  setState("running");
                  setError(manualClaim ? "Self-mint in progress. Please confirm the mint transaction in your destination wallet." : null);
                  setTimeout(() => {
                    executeManualClaim({
                      message: claimData.message,
                      attestation: claimData.attestation,
                      destinationDomain: claimData.destination_domain,
                      destChain,
                      burnHash
                    });
                  }, 150);
                  return;
                }

                set(completeMilestone(activateMilestone(ms, "mint"), "attestation"));
                setError(claimData.error || (manualClaim ? "Self-mint enabled. Please confirm the mint transaction in your destination wallet." : "Backend gas is low, so please claim your USDC manually."));
                setState("claim_manual_required");
                return;
              }
              if (claimRes.ok && claimData.success) break;
              if (claimRes.status === 409) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              break;
            } catch (fetchErr: any) {
              if (fetchErr && fetchErr.message && fetchErr.message.includes('Failed to fetch')) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              throw fetchErr;
            }
          }

          if (claimRes && claimRes.status === 409) {
            console.log("[TxEngine] Attestation pending after initial polling. Setting attestation_pending UI state.");
            setError("Burn confirmed on-chain! Circle is currently verifying block finality (~1-3 mins). Your USDC is 100% safe — background relayer will complete the mint automatically.");
            setState("attestation_pending");

            if (!claimPollInterval) {
              activeIntervalsRef.current.push(setInterval(async () => {
                try {
                  const bgRes = await fetch('/api/bridge/claim', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({
                      burn_tx_hash: burnHash,
                      source_chain: sourceChain,
                      destination_chain: destChain,
                      wallet_address: address,
                      amount: formattedAmount,
                      token_symbol: fromAsset || "USDC"
                    })
                  });
                  if (bgRes.ok) {
                    const bgData = await bgRes.json();
                    if (bgData?.status === "MANUAL_CLAIM_REQUIRED" || bgData?.code === "RELAYER_LOW_GAS") {
                      clearEngineIntervals();
                      setManualClaimPayload({
                        message: bgData.message,
                        attestation: bgData.attestation,
                        destinationDomain: bgData.destination_domain,
                        destChain,
                        burnHash
                      });
                      set(completeMilestone(activateMilestone(ms, "mint"), "attestation"));
                      setError(bgData.error || "Backend gas is low, so please claim your USDC manually.");
                      setState("claim_manual_required");
                      return;
                    }
                    if (bgData.success && bgData.mint_tx_hash) {
                      clearEngineIntervals();
                      const finalMintHash = bgData.mint_tx_hash;
                      setMintHash(finalMintHash);
                      set(completeMilestone(activateMilestone(ms, "mint"), "attestation"));
                      set(completeMilestone(ms, "mint", finalMintHash));
                      setState("success");
                      saveTxHistory({
                        id: burnHash,
                        txHash: burnHash,
                        burnHash: burnHash,
                        mintHash: finalMintHash,
                        type: "bridge_cctp",
                        status: "success",
                        amount: formattedAmount,
                        fromAsset,
                        toAsset,
                        sourceChain,
                        destChain,
                        timestamp: Date.now(),
                        userAddress: address
                      });
                      clearHistoryCache(address);
                    }
                  }
                } catch (_) {}
              }, 8000));
            }
            return;
          }

          if (!claimRes || !claimData) throw new Error("Network timeout while claiming");
          if (!claimRes.ok) {
            const err = new Error(claimData.error || "Claim failed");
            (err as any).status = claimRes.status;
            throw err;
          }

          const mintTx = claimData.mint_tx_hash && claimData.mint_tx_hash !== "ALREADY_CLAIMED_ON_CHAIN" ? claimData.mint_tx_hash : burnHash;
          setMintHash(mintTx);

          // Real backend verification transition:
          // 1. Iris attestation signature was successfully verified by relayer -> complete "attestation"
          // 2. Activate "mint" milestone to show real on-chain claim submission before finalizing
          set(activateMilestone(completeMilestone(ms, "attestation"), "mint"));
          await new Promise((r) => setTimeout(r, 1500));

          // 3. Mark minting complete with actual destination transaction hash
          set(completeMilestone(completeMilestone(ms, "attestation"), "mint", mintTx));
          setTotalMs(nowMs() - startTimeRef.current);
          setState("success");

          saveTxHistory({ id: burnHash, txHash: burnHash, burnHash: burnHash, mintHash: mintTx, type: "bridge_cctp", status: "success", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: address });
          clearHistoryCache(address);
          return;
        }

        if (sourceChain.includes("Solana")) {
          // ══════════════════════════════════════════════════════════════════════
          // NATIVE SOLANA -> EVM FLOW (Solana Mainnet / Devnet -> Any EVM Chain)
          // ══════════════════════════════════════════════════════════════════════
          const activeDomains = getCctpDomains(isMainnetChain(sourceChain) || isMainnetChain(destChain) ? "mainnet" : "testnet");
          const destDomain = activeDomains[destChain] || resolveCctpDomain(destChain, isMainnetChain(destChain) ? "mainnet" : "testnet");
          if (!destDomain) throw new Error(`CCTP configuration missing for ${destChain}`);

          const rawEvmAddress = params.destAddress || evmAddress;
          if (!rawEvmAddress) throw new Error(`Destination EVM address required for ${destChain}. Please connect your EVM wallet.`);

          let targetEvmAddress: string;
          if (rawEvmAddress.startsWith('0x')) {
            const paddedHex = padHex(rawEvmAddress as `0x${string}`, { size: 32 }).replace(/^0x/, '');
            const bytes = Buffer.from(paddedHex, 'hex');
            targetEvmAddress = new PublicKey(bytes).toBase58();
          } else {
            targetEvmAddress = rawEvmAddress;
          }

          set(completeMilestone(activateMilestone(ms, "burn"), "appr"));

          const sourceAdapter = await resolveAdapter(sourceChain);
          const handler = (sourceAdapter as any).actionRegistry?.actionHandlers?.get('cctp.v2.depositForBurn');
          if (!handler) throw new Error("cctp.v2.depositForBurn handler not found on Solana adapter");

          const targetChain = sourceChain.includes("Devnet") ? SolanaDevnet : Solana;
          const adapterAddress = await (sourceAdapter as any).getAddress(targetChain);

          const customDestChain = {
            type: "evm",
            chain: destChain.replace(/\s+/g, '_'),
            name: destChain,
            usdcAddress: destDomain.usdc,
            cctp: {
              domain: destDomain.domain,
              contracts: {
                v2: {
                  type: "split",
                  tokenMessenger: destDomain.tokenMessenger,
                  messageTransmitter: destDomain.messageTransmitter
                }
              }
            }
          };

          const actionResult = await handler({
            fromChain: targetChain,
            toChain: customDestChain,
            amount: parseUnits(formattedAmount, 6).toString(),
            mintRecipient: targetEvmAddress,
            destinationAddress: targetEvmAddress,
            destinationCaller: "11111111111111111111111111111111"
          }, {
            chain: targetChain,
            address: adapterAddress
          });

          const txSig = await actionResult.execute();
          console.log("[SolanaBurn] Custom Solana burn submitted! Signature:", txSig);

          localBurnTx = txSig;
          setBurnHash(txSig);
          setTxHash(txSig);

          setMilestones((prev) => {
            let next = completeMilestone(prev, "appr");
            next = completeMilestone(next, "burn", txSig);
            next = activateMilestone(next, "attestation");
            return next;
          });
          setState("running");

          await syncBridgeWithRetry({
            wallet_address: address,
            source_chain: sourceChain,
            destination_chain: destChain,
            token_symbol: fromAsset,
            amount: formattedAmount,
            burn_tx_hash: txSig,
            source_address: solanaWallet.publicKey ? solanaWallet.publicKey.toBase58() : undefined
          });

          // Wait for backend relayer to claim (poll Circle Iris attestation + mint on destination chain)
          let lastWasAttestationPending = false;
          await new Promise<void>((resolve) => {
            claimPollInterval = setInterval(async () => {
              try {
                const elapsed = nowMs() - startTimeRef.current;
                if (elapsed > 600000) {
                  isForceResolved = true;
                  if (claimPollInterval) clearInterval(claimPollInterval);
                  if (lastWasAttestationPending) {
                    setMilestones((prev) => {
                      let next = completeMilestone(prev, "appr");
                      next = completeMilestone(next, "burn", txSig);
                      next = activateMilestone(next, "attestation");
                      return next;
                    });
                    setState("attestation_pending");
                  } else {
                    setMilestones((prev) => {
                      let next = completeMilestone(prev, "appr");
                      next = completeMilestone(next, "burn", txSig);
                      next = completeMilestone(next, "attestation");
                      next = activateMilestone(next, "mint");
                      return next;
                    });
                    setError("Relayer is taking longer than expected. You can claim manually below or from Bridge History.");
                    setState("claim_manual_required");
                  }
                  resolve();
                  return;
                }

                const claimRes = await fetch('/api/bridge/claim', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'x-wallet-address': address || ''
                  },
                  body: JSON.stringify({
                    burn_tx_hash: txSig,
                    source_chain: sourceChain,
                    destination_chain: destChain,
                    wallet_address: address,
                    amount: formattedAmount,
                    manual_claim: manualClaim
                  })
                });

                if (claimRes.status === 409) {
                  lastWasAttestationPending = true;
                  setMilestones((prev) => {
                    let next = completeMilestone(prev, "appr");
                    next = completeMilestone(next, "burn", txSig);
                    next = activateMilestone(next, "attestation");
                    return next;
                  });
                  return;
                }
                lastWasAttestationPending = false;

                if (claimRes.ok) {
                  const json = await claimRes.json();
                  if (json.status === "MANUAL_CLAIM_REQUIRED" || json.code === "RELAYER_LOW_GAS" || (manualClaim && (json.message || json.status === "READY_TO_CLAIM"))) {
                    isForceResolved = true;
                    if (claimPollInterval) clearInterval(claimPollInterval);
                    const claimPayload = {
                      message: json.message,
                      attestation: json.attestation,
                      destinationDomain: json.destination_domain,
                      destChain,
                      burnHash: txSig
                    };
                    setManualClaimPayload(claimPayload);

                    let updatedMs = completeMilestone(ms, "attestation");
                    const destConfig = ChainRegistry.getChainSafe(destChain);
                    const isSolana = destChain.toLowerCase().includes("solana");
                    const isEvm = destConfig && destConfig.chainId > 0 && !isSolana;

                    // Ensure "switch" step is present only for EVM destinations
                    const hasSwitch = updatedMs.some((m) => m.id === "switch");
                    if (!hasSwitch && isEvm) {
                      const attIdx = updatedMs.findIndex((m) => m.id === "attestation");
                      const switchNode: Milestone = { id: "switch", label: `Switch to ${destChain}`, status: "pending" };
                      updatedMs.splice(attIdx + 1, 0, switchNode);
                    }

                    if (isSolana) {
                      // Solana destination: User is on bridge page!
                      // Instantly activate mint milestone and auto-trigger destination claim!
                      updatedMs = activateMilestone(updatedMs, "mint");
                      setMilestones([...updatedMs]);
                      setState("running");
                      setError(null);
                      setTimeout(() => {
                        executeManualClaim(claimPayload);
                      }, 200);
                      resolve();
                      return;
                    }

                    let currentChainId = publicClient?.chain?.id;
                    try {
                      const provider = connector ? await connector.getProvider() : undefined;
                      if (provider && typeof (provider as any).request === 'function') {
                        const chainIdHex = await (provider as any).request({ method: 'eth_chainId' });
                        currentChainId = typeof chainIdHex === 'string' ? parseInt(chainIdHex, 16) : Number(chainIdHex);
                      }
                    } catch (_) {}

                    const alreadyOnDest = isEvm && currentChainId === destConfig.chainId;

                    if (alreadyOnDest) {
                      updatedMs = completeMilestone(updatedMs, "switch");
                      updatedMs = activateMilestone(updatedMs, "mint");
                      setMilestones([...updatedMs]);
                      setState("claim_manual_required");
                      setError(null);
                      setTimeout(() => {
                        executeManualClaim(claimPayload);
                      }, 200);
                      resolve();
                      return;
                    }

                    updatedMs = activateMilestone(updatedMs, "switch");
                    setMilestones([...updatedMs]);
                    setState("claim_manual_required");
                    setError(`Please switch your wallet network to ${destChain} to complete your claim.`);

                    if (isEvm && switchChainAsync) {
                      try {
                        console.log(`[TxEngine] Auto-prompting wallet switch to ${destChain} (${destConfig.chainId})...`);
                        await switchChainAsync({ chainId: destConfig.chainId });
                        let postSwitchMs = completeMilestone(updatedMs, "switch");
                        postSwitchMs = activateMilestone(postSwitchMs, "mint");
                        setMilestones([...postSwitchMs]);
                        setError(null);
                        setTimeout(() => {
                          executeManualClaim(claimPayload);
                        }, 200);
                      } catch (switchErr) {
                        console.warn("[TxEngine] Wallet switch dismissed or cancelled by user:", switchErr);
                      }
                    }
                    resolve();
                    return;
                  } else if (json.success && !isForceResolved && json.mint_tx_hash) {
                    isForceResolved = true;
                    if (claimPollInterval) clearInterval(claimPollInterval);
                    const finalMintHash = json.mint_tx_hash;
                    setMintHash(finalMintHash);
                    setMilestones((prev) => {
                      let next = completeMilestone(prev, "appr");
                      next = completeMilestone(next, "burn", txSig);
                      next = completeMilestone(next, "attestation");
                      next = activateMilestone(next, "mint");
                      next = completeMilestone(next, "mint", finalMintHash);
                      return next;
                    });
                    setTotalMs(nowMs() - startTimeRef.current);
                    setState("success");
                    clearHistoryCache(address);
                    if (typeof window !== "undefined") {
                      window.dispatchEvent(new CustomEvent("arcfun_tx_notify", {
                        detail: {
                          wallet_address: address,
                          source_chain: sourceChain,
                          destination_chain: destChain,
                          amount: formattedAmount,
                          token_symbol: fromAsset || "USDC",
                          burn_tx_hash: txSig,
                          mint_tx_hash: finalMintHash,
                          bridge_status: "COMPLETED"
                        }
                      }));
                    }
                    resolve();
                  }
                }
              } catch (err) {
                console.warn("[SolanaCustomClaimPoll] Error:", err);
              }
            }, 3000);
            activeIntervalsRef.current.push(claimPollInterval);
          });
          return;
        }

        // ══════════════════════════════════════════════════════════════════════
        // DEFAULT APP KIT ROUTE (EVM <-> SOLANA)
        // ══════════════════════════════════════════════════════════════════════
        const sourceAdapter = await resolveAdapter(sourceChain);
        const destAdapter = await resolveAdapter(destChain);

        // Resolve destination chain definition to build a robust local client for background confirmation
        const supportedChains = getKit().getSupportedChains();
        const destChainDef = supportedChains.find((c: any) =>
          c.name === destChain || c.chain === destChain.replaceAll(" ", "_")
        );
        const destChainId = (destChainDef as any)?.chainId ?? (destChainDef as any)?.id ?? 0;
        const CHAIN_RPC_OVERRIDES: Record<number, string[]> = {
          1439: [
            "https://k8s.testnet.json-rpc.injective.network/",
            "https://injectiveevm-testnet-rpc.polkachu.com"
          ],
          10143: [
            process.env.NEXT_PUBLIC_MONAD_TESTNET_RPC_URL || "https://testnet-rpc.monad.xyz",
            "https://testnet-rpc.monad.xyz",
            "https://monad-testnet-rpc.g.allthatnode.com/default",
            "https://rpc-devnet.monad.xyz"
          ],
        };
        const destRpcs = destChainDef ? (CHAIN_RPC_OVERRIDES[destChainId] ?? [(destChainDef as any).rpcEndpoints?.[0] ?? (destChainDef as any).rpcUrls?.default?.http?.[0]]) : [];

        const destPublicClient = destChainDef ? createPublicClient({
          chain: destChainDef as any,
          transport: fallback(destRpcs.map(url => http(url, { retryCount: 3, retryDelay: 1000, batch: false })))
        }) : null;

        backgroundPollInterval = null;
        claimPollInterval = null;
        isForceResolved = false;
        const txHashesCaptured = new Set<string>();

        const handleStep = (step: any) => {
          const stepName = String(step.values?.name || step.name || step.action || "").toLowerCase();
          const stepHash = step.values?.txHash || step.txHash || "";
          const stepState = step.values?.state || step.state || "";

          if (stepName.includes("approve")) {
            if (stepState === "success" || stepHash) {
              setMilestones((prev) => completeMilestone(activateMilestone(prev, "burn"), "appr", stepHash || undefined));
            } else if (stepState === "executing" || stepState === "pending") {
              setMilestones((prev) => activateMilestone(prev, "appr"));
            }
          }

          if (stepHash && !stepName.includes("approve")) {
            if (!txHashesCaptured.has(stepHash)) {
              txHashesCaptured.add(stepHash);

              if (txHashesCaptured.size === 1) {
                // First non-approval hash is the burn transaction!
                localBurnTx = stepHash;
                setBurnHash(stepHash);
                setTxHash(stepHash);
                console.log("[BURN_CONFIRMED] Burn transaction hash captured:", stepHash);

                // Immediately transition frontend milestone state to burn done & attestation active
                setMilestones((prev) => {
                  let next = completeMilestone(prev, "appr");
                  next = completeMilestone(next, "burn", stepHash);
                  next = activateMilestone(next, "attestation");
                  return next;
                });
                setState("running");

                // Structurally terminate the SDK's destination-chain flow (switch network / mint)
                // This will force the monolithic SDK bridge promise to reject with FLOW_TERMINATED,
                // which is handled safely by the catch block.
                isBridgeActiveRef.current = false;

                syncBridgeWithRetry({
                  wallet_address: address,
                  source_chain: sourceChain,
                  destination_chain: destChain,
                  token_symbol: fromAsset,
                  amount: formattedAmount,
                  burn_tx_hash: stepHash,
                  source_address: solanaWallet.publicKey ? solanaWallet.publicKey.toBase58() : undefined
                }).then((synced) => {
                  if (synced && !claimPollInterval && !isForceResolved) {
                    console.log("[CLAIM_POLL_STARTED] Starting background claim polling for burn:", stepHash);
                    // Start background polling /api/bridge/claim (which checks on-chain claim status and updates DB)
                    // Track whether last poll was attestation-pending so timeout shows correct UI
                  let lastWasAttestationPending1 = false;
                  claimPollInterval = setInterval(async () => {
                      try {
                        const elapsed = nowMs() - startTimeRef.current;
                        if (elapsed > 600000) { // 10 minutes timeout — give Circle Iris plenty of room
                          console.warn("[CLAIM_TIMEOUT] Relayer claim taking too long.", lastWasAttestationPending1 ? "Attestation still pending." : "Falling back to manual claim.");
                          isForceResolved = true;
                          if (claimPollInterval) clearInterval(claimPollInterval);
                          if (backgroundPollInterval) clearInterval(backgroundPollInterval);

                          if (lastWasAttestationPending1) {
                            // Circle Iris still hasn't attested — show reassurance UI, not manual claim
                            console.log("[CLAIM_TIMEOUT] Last poll was attestation-pending. Setting attestation_pending state.");
                            setMilestones((prev) => {
                              let next = completeMilestone(prev, "burn", localBurnTx || undefined);
                              next = activateMilestone(next, "attestation");
                              return next;
                            });
                            setState("attestation_pending");
                          } else {
                            setMilestones((prev) => {
                              let next = completeMilestone(prev, "burn", localBurnTx || undefined);
                              next = completeMilestone(next, "attestation");
                              next = activateMilestone(next, "mint");
                              return next;
                            });
                            setError("Our relayer is taking longer than expected. You can claim it manually below, or wait a bit more and retry.");
                            setState("claim_manual_required");
                          }
                          return;
                        }

                        const claimRes = await fetch('/api/bridge/claim', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ burn_tx_hash: stepHash, manual_claim: manualClaim })
                        });

                        if (claimRes.status === 409) {
                          lastWasAttestationPending1 = true;
                          console.log("[CLAIM_POLL] Circle Iris attestation pending (HTTP 409). Continuing background polling...");
                          // Keep polling — show attestation step as active
                          setMilestones((prev) => {
                            let next = completeMilestone(prev, "appr");
                            next = completeMilestone(next, "burn", localBurnTx || stepHash);
                            next = activateMilestone(next, "attestation");
                            return next;
                          });
                          return;
                        }
                        lastWasAttestationPending1 = false;

                        if (claimRes.ok) {
                          const json = await claimRes.json();
                          if (json.status === "MANUAL_CLAIM_REQUIRED" || json.code === "RELAYER_LOW_GAS" || json.status === "READY_TO_CLAIM" || (manualClaim && json.message)) {
                            isForceResolved = true;
                            clearEngineIntervals();

                            const claimPayload = {
                              message: json.message,
                              attestation: json.attestation,
                              destinationDomain: json.destination_domain,
                              destChain,
                              burnHash: localBurnTx || stepHash
                            };
                            setManualClaimPayload(claimPayload);

                            setMilestones((prev) => {
                              let next = completeMilestone(prev, "burn", localBurnTx || undefined);
                              next = completeMilestone(next, "attestation");
                              next = activateMilestone(next, "mint");
                              return next;
                            });

                            const isSolana = destChain.toLowerCase().includes("solana");
                            if (isSolana) {
                              console.log("[TxEngine] Attestation ready for Solana destination. Auto-triggering destination mint in Phantom...");
                              setState("running");
                              setError(manualClaim ? "Self-mint in progress. Please confirm the mint transaction in your destination wallet." : null);
                              setTimeout(() => {
                                executeManualClaim(claimPayload);
                              }, 150);
                              return;
                            }

                            setError(manualClaim ? "Self-mint enabled. Please confirm the mint transaction in your destination wallet." : (json.error || json.reason || "Destination relayer gas is low. Your USDC is safe on-chain and ready to claim manually."));
                            setState("claim_manual_required");
                            console.log("[CLAIM_MANUAL_REQUIRED] Relayer low gas reported, manual claim fallback activated.");
                          } else if (json.success && !isForceResolved && json.mint_tx_hash) {
                            isForceResolved = true;
                            clearEngineIntervals();

                            const finalMintHash = json.mint_tx_hash;
                            setMintHash(finalMintHash);
                            setMilestones((prev) => {
                              let next = completeMilestone(prev, "appr");
                              next = completeMilestone(next, "burn", localBurnTx || stepHash);
                              next = completeMilestone(next, "attestation");
                              next = activateMilestone(next, "mint");
                              next = completeMilestone(next, "mint", finalMintHash);
                              return next;
                            });
                            setTotalMs(nowMs() - startTimeRef.current);
                            setState("success");
                            clearHistoryCache(address);
                            if (typeof window !== "undefined") {
                              window.dispatchEvent(new CustomEvent("arcfun_tx_notify", {
                                detail: {
                                  wallet_address: address,
                                  source_chain: sourceChain,
                                  destination_chain: destChain,
                                  amount: formattedAmount,
                                  token_symbol: fromAsset || "USDC",
                                  burn_tx_hash: localBurnTx || burnHash,
                                  mint_tx_hash: finalMintHash,
                                  bridge_status: "COMPLETED"
                                }
                              }));
                            }
                            console.log("[CLAIM_COMPLETED] Bridge transaction completed successfully via backend claim:", finalMintHash);
                          }
                        }
                      } catch (_) {
                        // Keep polling silently
                      }
                    }, 6000);
                    activeIntervalsRef.current.push(claimPollInterval);
                  }
                }).catch(err => console.error("API bridge sync error:", err));
              } else if (txHashesCaptured.size === 2) {
                // Second non-approval hash is the mint/claim transaction!
                setMintHash(stepHash);

                // Start direct receipt polling in the background (bypasses any SDK polling hangs)
                if (destPublicClient && !backgroundPollInterval && !isForceResolved) {
                  backgroundPollInterval = setInterval(async () => {
                    try {
                      const receipt = await destPublicClient.getTransactionReceipt({ hash: stepHash as `0x${string}` });
                      if (receipt && receipt.status === "success" && !isForceResolved) {
                        isForceResolved = true;
                        if (backgroundPollInterval) clearInterval(backgroundPollInterval);
                        if (claimPollInterval) clearInterval(claimPollInterval);

                        setMintHash(stepHash);
                        setMilestones((prev) => {
                          let next = completeMilestone(prev, "appr");
                          next = completeMilestone(next, "burn", localBurnTx || undefined);
                          next = completeMilestone(next, "attestation");
                          next = completeMilestone(next, "mint", stepHash);
                          return next;
                        });
                        setTotalMs(nowMs() - startTimeRef.current);
                        setState("success");

                        saveTxHistory({ id: localBurnTx || "", txHash: localBurnTx || "", burnHash: localBurnTx || "", mintHash: stepHash, type: "bridge_cctp", status: "success", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: address });

                        if (typeof window !== "undefined") {
                          window.dispatchEvent(new CustomEvent("arcfun_tx_notify", {
                            detail: {
                              wallet_address: address,
                              source_chain: sourceChain,
                              destination_chain: destChain,
                              amount: formattedAmount,
                              burn_tx_hash: localBurnTx,
                              mint_tx_hash: stepHash,
                              bridge_status: "COMPLETED"
                            }
                          }));
                        }

                        fetch('/api/bridge/complete', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            wallet_address: address,
                            burn_tx_hash: localBurnTx,
                            mint_tx_hash: stepHash
                          })
                        }).then((res) => {
                          if (res.ok) clearHistoryCache(address);
                        }).catch(err => console.error("API bridge complete background error:", err));
                      }
                    } catch (_) {
                      // RPC indexes might lag, keep polling silently
                    }
                  }, 4000);
                }
              }
            }
          }
        };
        getKit().on("*", handleStep as any);

        let result;
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
            if (chainName === "Solana Mainnet" || chainName === "Solana") return "Solana";
            return chainName.replaceAll(" ", "_");
          };

          // 120-second timeout to prevent infinite polling if RPC indexers delay transaction receipts
          const timeout = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("VERIFICATION_TIMEOUT")), 120000)
          );

          const getDestAddress = (chainName: string) => {
            if (chainName.includes("Solana")) return solanaWallet?.publicKey?.toBase58() || "";
            if (chainName.includes("Stellar")) return stellarWallet?.address || "";
            return evmAddress || "";
          };
          const destAddressVal = params.destAddress || getDestAddress(destChain);

          const proxiedDestAdapter = new Proxy(destAdapter, {
            get(target, prop, receiver) {
              if (prop === 'getAddress') {
                return async () => destAddressVal;
              }
              if (prop === 'address') {
                return typeof (target as any).address === 'function' || typeof (target as any).address === 'undefined'
                  ? () => Promise.resolve(destAddressVal)
                  : destAddressVal;
              }
              if (prop === 'getAccounts') {
                return async () => [{ address: destAddressVal }];
              }
              if (prop === 'accounts') {
                return [{ address: destAddressVal }];
              }
              const value = Reflect.get(target, prop);
              return typeof value === 'function' ? value.bind(target) : value;
            }
          });

          const isDestEvm = (destAdapter as any)?.type === "evm" || (!destChain.includes("Solana") && !destChain.includes("Stellar"));

          const toParam: any = {
            adapter: proxiedDestAdapter as any,
            chain: formatChain(destChain) as any
          };

          result = await Promise.race([
            getKit().bridge({
              from: { adapter: sourceAdapter as any, chain: formatChain(sourceChain) as any },
              to: toParam,
              amount: formattedAmount
            }),
            timeout
          ]);
        } finally {
          getKit().off("*", handleStep as any);
          if (backgroundPollInterval) clearInterval(backgroundPollInterval);
          if (claimPollInterval && !localBurnTx) clearInterval(claimPollInterval);
        }

        if (isForceResolved) return;

        if (result.state !== "success") {
          const errorStep = result.steps?.find((s: any) => s.state === "error");
          throw new Error((errorStep?.error as any)?.message || "Bridge execution returned an error state.");
        }

        const burnTx = result.steps?.find((s: any) => s.name === "burn" || s.action === "bridge:burn")?.txHash;
        const mintTx = result.steps?.find((s: any) => s.name === "mint" || s.action === "bridge:mint")?.txHash;

        if (!burnTx || !mintTx) {
          throw new Error("Bridge Not Confirmed");
        }

        setBurnHash(burnTx);
        setMintHash(mintTx);
        setTxHash(burnTx);

        setMilestones((prev) => {
          let next = completeMilestone(prev, "appr");
          next = completeMilestone(next, "burn", burnTx);
          next = completeMilestone(next, "attestation");
          next = activateMilestone(next, "mint");
          next = completeMilestone(next, "mint", mintTx);
          return next;
        });
        setTotalMs(nowMs() - startTimeRef.current);
        setState("success");

        // Save History
        saveTxHistory({ id: burnTx, txHash: burnTx, burnHash: burnTx, mintHash: mintTx, type: "bridge_cctp", status: "success", amount: formattedAmount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress: address });

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("arcfun_tx_notify", {
            detail: {
              wallet_address: address,
              source_chain: sourceChain,
              destination_chain: destChain,
              amount: formattedAmount,
              token_symbol: fromAsset || "USDC",
              burn_tx_hash: burnTx,
              mint_tx_hash: mintTx,
              bridge_status: "COMPLETED"
            }
          }));
        }

        fetch('/api/bridge/complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_address: address,
            burn_tx_hash: burnTx,
            mint_tx_hash: mintTx
          })
        }).then((res) => {
          if (!res.ok) console.error("API bridge complete error:", res.status);
          clearHistoryCache(address);
        }).catch(err => console.error("API bridge complete network error:", err));

      } catch (e: unknown) {
        const errMsg = String((e as any)?.message || e || "");
        if (isForceResolved || errMsg.includes("FLOW_TERMINATED")) {
          console.log("[TxEngine] Bridge flow intercepted/terminated intentionally. Keeping background poller active.");
          return;
        }

        if (localBurnTx) {
          // Post-burn SDK errors are expected (e.g. destination RPC failures) — our relayer handles minting
          console.warn("[TxEngine] Post-burn SDK error (expected, relayer will handle mint):", errMsg);
        } else {
          console.error("Bridge Error:", e);
        }

        // FALLBACK ERROR INTROSPECTION:
        // If the event listener dropped the payload, check the Error object's steps array for burn hash.
        if (!localBurnTx && e && typeof e === 'object') {
          const steps = (e as any).steps || (e as any).details?.steps || [];
          (process.env.NODE_ENV === "development" ? console.log : () => { })("Fallback introspection found steps:", steps);
          const burnStep = steps.find((s: any) => s.txHash && !String(s.action || s.name || "").toLowerCase().includes("approve"));
          if (burnStep?.txHash) {
            (process.env.NODE_ENV === "development" ? console.log : () => { })("Fallback introspection captured burn hash:", burnStep.txHash);
            localBurnTx = burnStep.txHash;
          }
        }

        let underlyingError = e;
        if (e && typeof e === 'object') {
          const steps = (e as any).steps || (e as any).details?.steps || [];
          const errorStep = steps.find((s: any) => s.state === "error" || s.error);
          if (errorStep?.error) {
            underlyingError = errorStep.error;
          }
        }

        const isUserRejection = isUserWalletRejection(underlyingError);
        const isManualClaimRequired = String((underlyingError as any)?.message || underlyingError).includes("MANUAL_CLAIM_REQUIRED");

        if (localBurnTx) {
          if (isUserRejection) {
            console.log("[MINT_REJECTED] User cancelled destination mint on chain:", destChain);
            if (backgroundPollInterval) clearInterval(backgroundPollInterval);
            if (claimPollInterval) clearInterval(claimPollInterval);

            // Immediately notify backend & save local state as pending claim
            try {
              fetch('/api/bridge/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  burn_tx_hash: localBurnTx,
                  action: 'cancel_mint',
                  wallet_address: address,
                }),
              }).catch(console.error);

              saveTxHistory({
                id: localBurnTx,
                txHash: localBurnTx,
                burnHash: localBurnTx,
                type: "bridge_cctp",
                status: "pending",
                amount: formattedAmount,
                fromAsset: fromAsset || "USDC",
                toAsset: toAsset || "USDC",
                sourceChain,
                destChain,
                timestamp: Date.now(),
                userAddress: address,
                failureReason: "Mint cancelled in wallet - Ready to claim"
              }, isMainnetChain(sourceChain) ? "mainnet" : "testnet");

              clearHistoryCache(address);
            } catch (notifyErr) {
              console.warn("[TxEngine] Failed to persist cancelled claim:", notifyErr);
            }

            setMilestones((prev) => {
              let next = completeMilestone(prev, "appr");
              next = completeMilestone(next, "burn", localBurnTx || undefined);
              next = completeMilestone(next, "attestation");
              next = next.map((m) =>
                m.id === "mint"
                  ? { ...m, label: "Mint Cancelled in Wallet", status: "failed" as const, completedAt: nowMs() }
                  : m
              );
              return next;
            });

            setError("Mint transaction was cancelled in your wallet. Your funds remain safe on-chain and claimable.");
            setState("mint_rejected");
            return;
          }

          if (isManualClaimRequired) {
            console.log("[CLAIM_MANUAL_REQUIRED] Relayer low gas detected after burn:", localBurnTx);

            if (backgroundPollInterval) clearInterval(backgroundPollInterval);
            if (claimPollInterval) clearInterval(claimPollInterval);

            setMilestones((prev) => {
              let next = completeMilestone(prev, "appr");
              next = completeMilestone(next, "burn", localBurnTx || undefined);
              next = completeMilestone(next, "attestation");
              next = activateMilestone(next, "mint");
              return next;
            });

            setError("Destination relayer gas is low. Your USDC is safe on-chain and ready to claim manually.");
            setState("claim_manual_required");
            return;
          }

          // Non-user-rejection error OR user rejection of obsolete prompts (like network switch) AFTER burn is confirmed:
          // Invariant: Do NOT cancel background claiming, do NOT mark failed, keep the transaction recoverable!
          console.log("[BURN_CONFIRMED] Burn succeeded. Post-burn error/termination handled gracefully. Keeping background claim poller active:", localBurnTx);

          setMilestones((prev) => {
            let next = completeMilestone(prev, "appr");
            next = completeMilestone(next, "burn", localBurnTx || undefined);
            next = activateMilestone(next, "attestation");
            return next;
          });
          setState("running");

          // Re-create claim poller if it got cleared, or keep it running!
          if (!claimPollInterval && !isForceResolved) {
            console.log("[CLAIM_POLL_STARTED] Re-creating background claim poller for burn:", localBurnTx);
            const stepHash = localBurnTx;
            // Track whether last poll was attestation-pending so timeout shows correct UI
            let lastWasAttestationPending2 = false;
            claimPollInterval = setInterval(async () => {
              try {
                const elapsed = nowMs() - startTimeRef.current;
                if (elapsed > 600000) { // 10 minutes — give Circle Iris plenty of room
                  console.warn("[CLAIM_TIMEOUT] Relayer claim taking too long.", lastWasAttestationPending2 ? "Attestation still pending." : "Falling back to manual claim.");
                  isForceResolved = true;
                  if (claimPollInterval) clearInterval(claimPollInterval);
                  if (backgroundPollInterval) clearInterval(backgroundPollInterval);

                  if (lastWasAttestationPending2) {
                    // Circle Iris still hasn't attested — show reassurance UI, not manual claim
                    console.log("[CLAIM_TIMEOUT] Last poll was attestation-pending. Setting attestation_pending state.");
                    setMilestones((prev) => {
                      let next = completeMilestone(prev, "appr");
                      next = completeMilestone(next, "burn", localBurnTx || undefined);
                      next = activateMilestone(next, "attestation");
                      return next;
                    });
                    setState("attestation_pending");
                  } else {
                    setMilestones((prev) => {
                      let next = completeMilestone(prev, "appr");
                      next = completeMilestone(next, "burn", localBurnTx || undefined);
                      next = completeMilestone(next, "attestation");
                      next = activateMilestone(next, "mint");
                      return next;
                    });
                    setError("Relayer is taking longer than expected. You can claim it manually below, or wait a bit more and retry.");
                    setState("claim_manual_required");
                  }
                  return;
                }

                const claimRes = await fetch('/api/bridge/claim', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ burn_tx_hash: stepHash, manual_claim: manualClaim })
                });

                if (claimRes.status === 409) {
                  lastWasAttestationPending2 = true;
                  console.log("[CLAIM_POLL] Circle Iris attestation pending (HTTP 409). Continuing background polling...");
                  setMilestones((prev) => {
                    let next = completeMilestone(prev, "appr");
                    next = completeMilestone(next, "burn", localBurnTx || undefined);
                    next = activateMilestone(next, "attestation");
                    return next;
                  });
                  return;
                }
                lastWasAttestationPending2 = false;

                if (claimRes.ok) {
                  const json = await claimRes.json();
                  if (json.status === "MANUAL_CLAIM_REQUIRED" || json.code === "RELAYER_LOW_GAS" || json.status === "READY_TO_CLAIM" || (manualClaim && json.message)) {
                    isForceResolved = true;
                    if (claimPollInterval) clearInterval(claimPollInterval);
                    if (backgroundPollInterval) clearInterval(backgroundPollInterval);

                    const claimPayload = {
                      message: json.message,
                      attestation: json.attestation,
                      destinationDomain: json.destination_domain,
                      destChain,
                      burnHash: localBurnTx || stepHash
                    };
                    setManualClaimPayload(claimPayload);

                    setMilestones((prev) => {
                      let next = completeMilestone(prev, "appr");
                      next = completeMilestone(next, "burn", localBurnTx || undefined);
                      next = completeMilestone(next, "attestation");
                      next = activateMilestone(next, "mint");
                      return next;
                    });

                    const isSolana = destChain.toLowerCase().includes("solana");
                    if (isSolana) {
                      console.log("[TxEngine] Attestation ready for Solana destination. Auto-triggering destination mint in Phantom...");
                      setState("running");
                      setError(manualClaim ? "Self-mint in progress. Please confirm the mint transaction in your destination wallet." : null);
                      setTimeout(() => {
                        executeManualClaim(claimPayload);
                      }, 150);
                      return;
                    }

                    setError(manualClaim ? "Self-mint enabled. Please confirm the mint transaction in your destination wallet." : (json.error || json.reason || "Destination relayer gas is low. Your USDC is safe on-chain and ready to claim manually."));
                    setState("claim_manual_required");
                    console.log("[CLAIM_MANUAL_REQUIRED] Manual claim mode activated.");
                  } else if (json.success && !isForceResolved && json.mint_tx_hash) {
                    isForceResolved = true;
                    if (claimPollInterval) clearInterval(claimPollInterval);
                    if (backgroundPollInterval) clearInterval(backgroundPollInterval);

                    const finalMintHash = json.mint_tx_hash;
                    setMintHash(finalMintHash);
                    setMilestones((prev) => {
                      let next = completeMilestone(prev, "appr");
                      next = completeMilestone(next, "burn", localBurnTx || undefined);
                      next = completeMilestone(next, "attestation");
                      next = activateMilestone(next, "mint");
                      next = completeMilestone(next, "mint", finalMintHash);
                      return next;
                    });
                    setTotalMs(nowMs() - startTimeRef.current);
                    setState("success");
                    clearHistoryCache(address);
                    console.log("[CLAIM_COMPLETED] Bridge transaction completed successfully via backend claim polling:", finalMintHash);
                  }
                }
              } catch (_) {
                // Keep polling
              }
            }, 6000);
          }
          return;
        }

        // --- Handle Cancellation or Error BEFORE Burn ---
        const isTimeout = e instanceof Error && e.message === "VERIFICATION_TIMEOUT";

        if (isUserRejection) {
          const failedIdx = ms.findIndex((m) => m.status === "active");
          if (failedIdx !== -1) set(failMilestone(ms, ms[failedIdx].id));
          setError("Bridge transaction was cancelled in your wallet before tokens were burned.");
          setState("failed");

          fetch('/api/bridge/fail', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet_address: address,
              source_chain: sourceChain,
              destination_chain: destChain,
              token_symbol: fromAsset,
              amount: formattedAmount,
              failure_reason: "USER_CANCELLED_BEFORE_BURN",
              burn_tx_hash: null
            })
          }).catch(console.error);

          saveTxHistory({
            id: `fail_${Date.now()}`,
            txHash: "",
            type: "bridge_cctp",
            status: "failed",
            amount: formattedAmount,
            fromAsset,
            toAsset,
            sourceChain,
            destChain,
            timestamp: Date.now(),
            userAddress: address
          });
          return;
        }

        const reason = isTimeout
          ? "Receipt verification timed out. The funds may have already reached your wallet. Please refresh and check your history."
          : parseRevertReason(e);
        const status = (e as any).status;
        const failedIdx = ms.findIndex((m) => m.status === "active");

        if (status === 409) {
          if (failedIdx !== -1) {
            setMilestones((prev) => prev.map((m, i) => i === failedIdx ? { ...m, status: "pending" } : m));
          }
          setError(reason);
          setState("pending");
        } else {
          if (failedIdx !== -1) set(failMilestone(ms, ms[failedIdx].id));
          setError(reason);
          setState("failed");
        }
      } finally {
        isBridgeActiveRef.current = false;
      }
    },
    [publicClient, walletClient, writeContractAsync, update, address, solanaWallet, stellarWallet, suiWallet, signSuiTx]
  );

  const executeManualClaim = useCallback(
    async (customPayload?: any) => {
      isBridgeActiveRef.current = true;
      const targetBurnHash = customPayload?.burnHash || manualClaimPayload?.burnHash || burnHash || summary?.burnHash || "";
      const targetDestChain = (customPayload?.destChain || manualClaimPayload?.destChain || summary?.destChain || "Base Sepolia").toString();
      const targetSourceChain = (customPayload?.sourceChain || summary?.sourceChain || "Ethereum Sepolia").toString();
      const amount = (customPayload?.amount || summary?.fromAmt || "0.1").toString();
      const fromAsset = (customPayload?.fromAsset || summary?.fromAsset || "USDC").toString();

      let msg = customPayload?.message || manualClaimPayload?.message;
      let att = customPayload?.attestation || manualClaimPayload?.attestation;

      // Always populate milestones & summary if called directly from History
      const fallbackMilestones: Milestone[] = [
        { id: "appr", label: `Approve ${amount} ${fromAsset}`, status: "done" },
        { id: "burn", label: `Burn ${amount} ${fromAsset}`, status: "done", completedAt: nowMs(), txHash: targetBurnHash || undefined },
        { id: "attestation", label: "Iris Attestation", status: "done", completedAt: nowMs() },
        { id: "mint", label: `Mint ${amount} ${fromAsset}`, status: "active", startedAt: nowMs() },
      ];

      setState("running");
      setError(null);
      setBurnHash(targetBurnHash);
      setTxHash(targetBurnHash);
      setSummary((prev) => prev || {
        fromAmt: amount,
        fromAsset,
        toAsset: fromAsset,
        type: "bridge",
        sourceChain: targetSourceChain,
        destChain: targetDestChain,
        burnHash: targetBurnHash
      });

      setMilestones((prev) => {
        if (!prev || prev.length === 0) {
          return fallbackMilestones;
        }
        let next = completeMilestone(prev, "appr");
        next = completeMilestone(next, "burn", targetBurnHash || undefined);
        next = completeMilestone(next, "attestation");
        next = activateMilestone(next, "mint");
        return next;
      });

      const isSolanaDest = targetDestChain.toLowerCase().includes("solana");

      // 1. If attestation not yet in memory OR destination is Solana, fetch attestation / check status via /api/bridge/claim
      if (!msg || !att || isSolanaDest) {
        try {
          const res = await fetch("/api/bridge/claim", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              burn_tx_hash: targetBurnHash,
              source_chain: targetSourceChain,
              destination_chain: targetDestChain,
              manual_claim: true,
              action: "get_attestation",
              force_relayer: false,
            }),
          });
          const data = await res.json();

          // If backend or Iris confirms the bridge has ALREADY completed on destination
          if (data.already_completed || data.bridge_status === "COMPLETED" || data.message === "Bridge already completed" || data.message === "Bridge already completed on-chain" || (data.success && data.mint_tx_hash && !data.attestation)) {
            const completedMintHash = data.mint_tx_hash || "ALREADY_CLAIMED_ON_CHAIN";
            setMilestones((prev) => {
              let next = completeMilestone(prev, "appr");
              next = completeMilestone(next, "burn", targetBurnHash || undefined);
              next = completeMilestone(next, "attestation");
              next = completeMilestone(next, "mint", completedMintHash);
              return next;
            });
            saveTxHistory({
              id: targetBurnHash,
              txHash: targetBurnHash,
              burnHash: targetBurnHash,
              mintHash: completedMintHash,
              fromAsset,
              toAsset: fromAsset,
              amount: amount || "0",
              status: "success",
              type: "bridge_cctp",
              sourceChain: targetSourceChain,
              destChain: targetDestChain,
              timestamp: Date.now(),
              userAddress: evmAddress || undefined
            }, isMainnetChain(targetSourceChain) ? "mainnet" : "testnet");
            setMintHash(completedMintHash);
            setState("success");
            clearHistoryCache(evmAddress);
            return;
          }

          if (data.message && data.attestation) {
            msg = data.message;
            att = data.attestation;
          }

          if (isSolanaDest) {
            // First: if already completed or has mint_tx_hash
            if (data.success && data.mint_tx_hash) {
              const completedMintHash = data.mint_tx_hash;
              setMilestones((prev) => {
                let next = completeMilestone(prev, "appr");
                next = completeMilestone(next, "burn", targetBurnHash || undefined);
                next = completeMilestone(next, "attestation");
                next = completeMilestone(next, "mint", completedMintHash);
                return next;
              });
              saveTxHistory({
                id: targetBurnHash,
                txHash: targetBurnHash,
                burnHash: targetBurnHash,
                mintHash: completedMintHash,
                fromAsset,
                toAsset: fromAsset,
                amount: amount || "0",
                status: "success",
                type: "bridge_cctp",
                sourceChain: targetSourceChain,
                destChain: targetDestChain,
                timestamp: Date.now(),
                userAddress: evmAddress || undefined
              }, isMainnetChain(targetSourceChain) ? "mainnet" : "testnet");
              setMintHash(completedMintHash);
              setState("success");
              clearHistoryCache(evmAddress);
              return;
            }

            // Prompt user's Solana wallet (Phantom / Solflare) if connected!
            if (solanaWallet && solanaWallet.publicKey && msg && att) {
              try {
                console.log("[Manual Claim] Solana wallet connected. Prompting wallet to sign mint transaction...");
                const provider = solanaWallet.wallet?.adapter || solanaWallet;
                if ((provider as any).isConnected === undefined && (provider as any).connected !== undefined) {
                  (provider as any).isConnected = (provider as any).connected;
                }
                const isDevnet = targetDestChain.toLowerCase().includes("devnet");
                const targetChain = isDevnet ? SolanaDevnet : Solana;
                const solanaRpc = isDevnet
                  ? (process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com")
                  : (process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL || "https://solana-rpc.publicnode.com");
                const { Connection } = await import("@solana/web3.js");
                const connection = new Connection(solanaRpc, "confirmed");

                const adapter = await createSolanaAdapterFromProvider({
                  provider: provider as any,
                  connection,
                  capabilities: { supportedChains: [targetChain] }
                });

                const cleanMsg = (msg.startsWith("0x") ? msg.slice(2) : msg);
                const cleanAtt = (att.startsWith("0x") ? att.slice(2) : att);
                const messageBuf = Buffer.from(cleanMsg, "hex");
                const sourceDomainNum = messageBuf.readUInt32BE(4);
                const allDomains = isDevnet ? CCTP_DOMAINS : MAINNET_CCTP_DOMAINS;
                let srcName = "";
                for (const [name, config] of Object.entries(allDomains)) {
                  if (config.domain === sourceDomainNum) {
                    srcName = name;
                    break;
                  }
                }
                const srcConfig = allDomains[srcName];
                const fromChain = {
                  type: srcName.toLowerCase().includes("stellar") ? "stellar" : "evm",
                  chain: srcName.replace(/\s+/g, "_"),
                  name: srcName,
                  usdcAddress: srcConfig?.usdc || "",
                  cctp: {
                    domain: sourceDomainNum,
                    contracts: {
                      v2: {
                        type: "split",
                        tokenMessenger: srcConfig?.tokenMessenger || "",
                        messageTransmitter: srcConfig?.messageTransmitter || ""
                      }
                    }
                  }
                };

                const handler = adapter.actionRegistry.actionHandlers.get("cctp.v2.receiveMessage");
                if (handler) {
                  const recipientHex = cleanMsg.slice(184 * 2, 216 * 2);
                  const { PublicKey } = await import("@solana/web3.js");
                  const recipientAta = new PublicKey(Buffer.from(recipientHex, "hex"));
                  let destOwner = solanaWallet.publicKey.toBase58();
                  try {
                    const accInfo = await connection.getAccountInfo(recipientAta);
                    if (accInfo && accInfo.data.length === 165) {
                      destOwner = new PublicKey(accInfo.data.slice(32, 64)).toBase58();
                    }
                  } catch (_) {}

                  const eventNonce = cleanMsg.slice(12 * 2, 44 * 2);
                  const adapterAddress = await adapter.getAddress(targetChain);

                  const result = await (handler as any)({
                    fromChain,
                    toChain: targetChain,
                    eventNonce,
                    destinationAddress: destOwner,
                    message: '0x' + cleanMsg,
                    attestation: '0x' + cleanAtt
                  }, {
                    chain: targetChain,
                    address: adapterAddress
                  });

                  console.log("[Manual Claim] Prompting Solana wallet to sign mint transaction...");
                  const signature = await result.execute();
                  console.log(`[Manual Claim] Solana wallet successfully signed & executed mint: ${signature}`);

                  setMintHash(signature);
                  setMilestones((prev) => {
                    let next = completeMilestone(prev, "attestation");
                    next = completeMilestone(next, "mint", signature);
                    return next;
                  });
                  setState("success");
                  saveTxHistory({
                    id: targetBurnHash,
                    txHash: targetBurnHash,
                    burnHash: targetBurnHash,
                    mintHash: signature,
                    fromAsset,
                    toAsset: fromAsset,
                    amount: amount || "0",
                    status: "success",
                    type: "bridge_cctp",
                    sourceChain: targetSourceChain,
                    destChain: targetDestChain,
                    timestamp: Date.now(),
                    userAddress: evmAddress || undefined
                  }, isMainnetChain(targetSourceChain) ? "mainnet" : "testnet");
                  clearHistoryCache(evmAddress);
                  return;
                }
              } catch (userWalletErr: any) {
                console.warn("[Manual Claim] Solana wallet user signature error:", userWalletErr);
                const errStr = String(userWalletErr?.message || userWalletErr).toLowerCase();
                if (errStr.includes("rejected") || errStr.includes("cancelled") || errStr.includes("user rejected")) {
                  setError("Claim transaction was cancelled in your Solana wallet. Your funds remain safe on-chain and claimable.");
                  setState("mint_rejected");
                  setMilestones((prev) => {
                    let next = completeMilestone(prev, "attestation");
                    next = next.map((m) =>
                      m.id === "mint"
                        ? { ...m, label: "Mint Cancelled in Wallet", status: "failed" as const, completedAt: nowMs() }
                        : m
                    );
                    return next;
                  });
                  return;
                }
                console.log("[Manual Claim] Non-rejection wallet error, falling back to backend relayer...");
              }
            }

            // Fallback: If wallet was not connected or non-rejection error, invoke backend relayer
            console.log(`[Manual Claim] Invoking backend relayer for ${targetBurnHash}...`);
            const relayerRes = await fetch("/api/bridge/claim", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                burn_tx_hash: targetBurnHash,
                source_chain: targetSourceChain,
                destination_chain: targetDestChain,
                force_relayer: true,
                action: "execute_claim"
              }),
            });
            const relayerData = await relayerRes.json();
            if (relayerData.success && (relayerData.mint_tx_hash || relayerData.already_completed || relayerData.bridge_status === "COMPLETED")) {
              const completedMintHash = relayerData.mint_tx_hash || "ALREADY_CLAIMED_ON_CHAIN";
              setMintHash(completedMintHash);
              setMilestones((prev) => {
                let next = completeMilestone(prev, "attestation");
                next = completeMilestone(next, "mint", completedMintHash);
                return next;
              });
              setState("success");
              saveTxHistory({
                id: targetBurnHash,
                txHash: targetBurnHash,
                burnHash: targetBurnHash,
                mintHash: completedMintHash,
                fromAsset,
                toAsset: fromAsset,
                amount: amount || "0",
                status: "success",
                type: "bridge_cctp",
                sourceChain: targetSourceChain,
                destChain: targetDestChain,
                timestamp: Date.now(),
                userAddress: evmAddress || undefined
              }, isMainnetChain(targetSourceChain) ? "mainnet" : "testnet");
              clearHistoryCache(evmAddress);
              return;
            } else {
              throw new Error(relayerData.error || relayerData.reason || "Failed to claim USDC on Solana");
            }
          }

          if (!res.ok || !data.message || !data.attestation) {
            throw new Error(data.error || "Attestation signature is still being prepared by Circle Iris. Please retry in a few moments.");
          }
          msg = data.message;
          att = data.attestation;
          setManualClaimPayload({
            message: msg,
            attestation: att,
            destinationDomain: data.destination_domain,
            destChain: targetDestChain,
            burnHash: targetBurnHash,
          });
        } catch (fetchErr: any) {
          setError(fetchErr?.message || "Failed to retrieve CCTP attestation");
          setState("claim_manual_required");
          return;
        }
      }

      const isEvmDest =
        !targetDestChain.includes("Solana") &&
        !targetDestChain.includes("Stellar") &&
        !targetDestChain.includes("Sui");

      if (isEvmDest) {
        const destConfig = ChainRegistry.getChainSafe(targetDestChain);
        if (!destConfig) {
          setError(`Unsupported destination network: ${targetDestChain}`);
          setState("failed");
          return;
        }

        // 2. Check and prompt network switch if needed
        let currentChainId = publicClient?.chain?.id;
        try {
          const provider = connector ? await connector.getProvider() : undefined;
          if (provider && typeof (provider as any).request === 'function') {
            const chainIdHex = await (provider as any).request({ method: 'eth_chainId' });
            currentChainId = typeof chainIdHex === 'string' ? parseInt(chainIdHex, 16) : Number(chainIdHex);
          }
        } catch (_) {}

        if (currentChainId !== destConfig.chainId) {
          try {
            console.log(`[Manual Claim] Prompting wallet switch to ${destConfig.name} (${destConfig.chainId})...`);
            await switchChainAsync({ chainId: destConfig.chainId });
            setMilestones((prev) => {
              let next = completeMilestone(prev, "switch");
              next = activateMilestone(next, "mint");
              return next;
            });
          } catch (switchErr: any) {
            console.warn("[Manual Claim] Chain switch rejected or failed:", switchErr);
            setError(`Please switch your wallet network to ${destConfig.name} to complete the claim.`);
            setState("claim_manual_required");
            return;
          }
        } else {
          setMilestones((prev) => {
            let next = completeMilestone(prev, "switch");
            next = activateMilestone(next, "mint");
            return next;
          });
        }

        // 3. Check user destination gas balance & check if already executed on destination
        try {
          if (publicClient && evmAddress) {
            // Pre-check if nonce has already been received on-chain
            try {
              const cleanMsg = (msg.startsWith("0x") ? msg.slice(2) : msg);
              const sourceDomainNum = parseInt(cleanMsg.slice(8, 16), 16);
              const nonceHex = cleanMsg.slice(24, 40);
              const nonceNum = BigInt("0x" + nonceHex);
              const hashKey = keccak256(encodePacked(['uint32', 'uint64'], [sourceDomainNum, nonceNum]));
              const rawNonce32 = ('0x' + cleanMsg.slice(24, 88)) as `0x${string}`;
              const isMainnet = isMainnetChain(targetDestChain);
              const activeDomains = getCctpDomains(isMainnet ? "mainnet" : "testnet");
              const domainDef = activeDomains[targetDestChain] || resolveCctpDomain(targetDestChain, isMainnet ? "mainnet" : "testnet");

              if (domainDef?.messageTransmitter) {
                const [usedHash, usedRaw] = await Promise.all([
                  publicClient.readContract({
                    address: domainDef.messageTransmitter as `0x${string}`,
                    abi: MESSAGE_TRANSMITTER_V2_ABI,
                    functionName: "usedNonces",
                    args: [hashKey],
                  }).catch(() => 0n),
                  publicClient.readContract({
                    address: domainDef.messageTransmitter as `0x${string}`,
                    abi: MESSAGE_TRANSMITTER_V2_ABI,
                    functionName: "usedNonces",
                    args: [rawNonce32],
                  }).catch(() => 0n),
                ]);

                if (usedHash > 0n || usedRaw > 0n) {
                  console.log(`[Manual Claim] Nonce ${nonceNum} already claimed on ${targetDestChain}! Auto-resolving as success.`);
                  saveTxHistory({
                    id: targetBurnHash,
                    txHash: targetBurnHash,
                    burnHash: targetBurnHash,
                    mintHash: "ALREADY_CLAIMED_ON_CHAIN",
                    type: "bridge_cctp",
                    status: "success",
                    amount: summary?.fromAmt || "0.01",
                    fromAsset: "USDC",
                    toAsset: "USDC",
                    sourceChain: targetSourceChain,
                    destChain: targetDestChain,
                    timestamp: Date.now(),
                    userAddress: evmAddress
                  });
                  setMilestones((prev) =>
                    completeMilestone(completeMilestone(prev, "attestation"), "mint", "ALREADY_CLAIMED_ON_CHAIN")
                  );
                  setState("success");
                  clearHistoryCache(evmAddress);
                  return;
                }
              }
            } catch (nonceCheckErr) {
              console.warn("[Manual Claim] Fast nonce pre-check warning:", nonceCheckErr);
            }

            const userBal = await publicClient.getBalance({ address: evmAddress });
            const feeData = await publicClient.getGasPrice().catch(() => 100000000n);
            const requiredWei = EVM_RECEIVE_MESSAGE_GAS_UNITS * feeData;
            if (userBal < requiredWei) {
              setError(`Insufficient ${destConfig.nativeCurrency.symbol} for this claim. Add gas to your destination wallet and try again.`);
              setState("claim_manual_required");
              return;
            }
          }
        } catch (balErr) {
          console.warn("[Manual Claim] User gas balance check warning:", balErr);
        }

        // 4. Submit receiveMessage transaction via user's wallet
        setState("running");
        setError(null);
        setMilestones((prev) => {
          let next = completeMilestone(prev, "attestation");
          next = activateMilestone(next, "mint");
          return next;
        });
        try {
          const isMainnet = isMainnetChain(targetDestChain);
          const activeDomains = getCctpDomains(isMainnet ? "mainnet" : "testnet");
          const domainDef = activeDomains[targetDestChain] || resolveCctpDomain(targetDestChain, isMainnet ? "mainnet" : "testnet");
          if (!domainDef?.messageTransmitter) {
            throw new Error(`MessageTransmitter address not configured for ${targetDestChain}`);
          }

          const formattedMsg = (msg.startsWith("0x") ? msg : `0x${msg}`) as `0x${string}`;
          const formattedAtt = (att.startsWith("0x") ? att : `0x${att}`) as `0x${string}`;

          console.log(`[Manual Claim] Calling receiveMessage on ${domainDef.messageTransmitter} on ${targetDestChain}...`);
          const mintTx = await writeContractAsync({
            address: domainDef.messageTransmitter as `0x${string}`,
            abi: MESSAGE_TRANSMITTER_V2_ABI,
            functionName: "receiveMessage",
            args: [formattedMsg, formattedAtt],
          });

          console.log(`[Manual Claim] Submitted destination claim tx: ${mintTx}`);
          setMintHash(mintTx);

          // Immediate optimistic completion: Wallet has broadcasted the verified mint transaction!
          // Mark UI milestones and success instantly so the user does not wait 10+ seconds.
          setMilestones((prev) => {
            let next = completeMilestone(prev, "attestation");
            next = completeMilestone(next, "mint", mintTx);
            return next;
          });
          setState("success");
          clearHistoryCache(evmAddress);

          // Immediately save to persistent history
          saveTxHistory({
            id: targetBurnHash,
            txHash: targetBurnHash,
            burnHash: targetBurnHash,
            mintHash: mintTx,
            type: "bridge_cctp",
            status: "success",
            amount: summary?.fromAmt || amount || "0.01",
            fromAsset: "USDC",
            toAsset: "USDC",
            sourceChain: targetSourceChain,
            destChain: targetDestChain,
            timestamp: Date.now(),
            userAddress: evmAddress
          }, isMainnet ? "mainnet" : "testnet");

          // Notify backend to mark transfer COMPLETED asynchronously in background
          (async () => {
            try {
              const { data: sessionData } = await supabase.auth.getSession();
              const token = sessionData.session?.access_token || "";
              await fetch("/api/bridge/complete", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                  burn_tx_hash: targetBurnHash,
                  mint_tx_hash: mintTx,
                }),
              });
            } catch (completeErr) {
              console.warn("[Manual Claim] Backend completion notify warning:", completeErr);
            }
          })();
        } catch (mintErr: any) {
          const msgLower = String(mintErr?.message || mintErr?.details || mintErr?.cause || mintErr).toLowerCase();

          // Check if nonce was already claimed (including Simulation revert "Nonce already used" or #-39000)
          let isAlreadyClaimedOnChain =
            msgLower.includes("already_claimed") ||
            msgLower.includes("already claimed") ||
            msgLower.includes("nonce already used") ||
            msgLower.includes("noncealreadyused") ||
            msgLower.includes("#-39000");

          // Always verify on-chain before declaring failure or cancellation
          if (!isAlreadyClaimedOnChain && publicClient && msg) {
            try {
              const cleanMsg = (msg.startsWith("0x") ? msg.slice(2) : msg);
              const sourceDomainNum = parseInt(cleanMsg.slice(8, 16), 16);
              const nonceHex = cleanMsg.slice(24, 40);
              const nonceNum = BigInt("0x" + nonceHex);
              const hashKey = keccak256(encodePacked(['uint32', 'uint64'], [sourceDomainNum, nonceNum]));
              const isMainnet = isMainnetChain(targetDestChain);
              const activeDomains = getCctpDomains(isMainnet ? "mainnet" : "testnet");
              const domainDef = activeDomains[targetDestChain] || resolveCctpDomain(targetDestChain, isMainnet ? "mainnet" : "testnet");
              if (domainDef?.messageTransmitter) {
                const used = await publicClient.readContract({
                  address: domainDef.messageTransmitter as `0x${string}`,
                  abi: MESSAGE_TRANSMITTER_V2_ABI,
                  functionName: "usedNonces",
                  args: [hashKey],
                }).catch(() => 0n);
                if (used > 0n) {
                  isAlreadyClaimedOnChain = true;
                }
              }
            } catch (postCheckErr) {
              console.warn("[Manual Claim] Post-error nonce verification warning:", postCheckErr);
            }
          }

          if (isAlreadyClaimedOnChain) {
            console.log(`[Manual Claim] Destination claim verified already completed on-chain. Auto-resolving as success.`);
            saveTxHistory({
              id: targetBurnHash,
              txHash: targetBurnHash,
              burnHash: targetBurnHash,
              mintHash: "ALREADY_CLAIMED_ON_CHAIN",
              type: "bridge_cctp",
              status: "success",
              amount: summary?.fromAmt || "0.01",
              fromAsset: "USDC",
              toAsset: "USDC",
              sourceChain: targetSourceChain,
              destChain: targetDestChain,
              timestamp: Date.now(),
              userAddress: evmAddress
            });
            setState("success");
            setMilestones((prev) =>
              completeMilestone(completeMilestone(prev, "attestation"), "mint", "ALREADY_CLAIMED_ON_CHAIN")
            );
            clearHistoryCache(evmAddress);
            return;
          }
          console.error("[Manual Claim] Transaction error:", mintErr);
          const isUserRejection = isUserWalletRejection(mintErr);
          if (isUserRejection) {
            setError("Claim transaction was cancelled in your wallet. Your funds remain safe on-chain and claimable.");
            setState("mint_rejected");
            setMilestones((prev) => {
              let next = completeMilestone(prev, "attestation");
              next = next.map((m) =>
                m.id === "mint"
                  ? { ...m, label: "Mint Cancelled in Wallet", status: "failed" as const, completedAt: nowMs() }
                  : m
              );
              return next;
            });

            // Immediately notify backend & save local state as pending claim
            try {
              fetch('/api/bridge/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  burn_tx_hash: targetBurnHash,
                  action: 'cancel_mint',
                  wallet_address: evmAddress || address,
                }),
              }).catch(console.error);

              saveTxHistory({
                id: targetBurnHash,
                txHash: targetBurnHash,
                burnHash: targetBurnHash,
                type: "bridge_cctp",
                status: "pending",
                amount: summary?.fromAmt || amount || "0.01",
                fromAsset: fromAsset || "USDC",
                toAsset: fromAsset || "USDC",
                sourceChain: targetSourceChain,
                destChain: targetDestChain,
                timestamp: Date.now(),
                userAddress: evmAddress || address,
                failureReason: "Mint cancelled in wallet - Ready to claim"
              }, isMainnetChain(targetSourceChain) ? "mainnet" : "testnet");

              clearHistoryCache(evmAddress || address);
            } catch (notifyErr) {
              console.warn("[Manual Claim] Failed to persist cancelled claim:", notifyErr);
            }
            return;
          }
          setError(parseRevertReason(mintErr));
          setState("claim_manual_required");
          setMilestones((prev) => {
            let next = completeMilestone(prev, "attestation");
            next = next.map((m) =>
              m.id === "mint"
                ? { ...m, label: "Mint Failed", status: "failed" as const, completedAt: nowMs() }
                : m
            );
            return next;
          });
        }
      } else if (targetDestChain.includes("Solana")) {
        // Solana claim handled above; if execution reached here with an error
        setError(`Please ensure your Solana wallet or relayer claims your USDC on ${targetDestChain}.`);
        setState("claim_manual_required");
      } else {
        // Other non-EVM chains
        setError(`Please claim your USDC on ${targetDestChain} using your destination wallet.`);
        setState("claim_manual_required");
      }
    },
    [burnHash, summary, manualClaimPayload, publicClient, evmAddress, switchChainAsync, writeContractAsync]
  );

  const executeResume = useCallback(async (pendingObj: any, onComplete?: () => void) => {
    isBridgeActiveRef.current = true;
    if (!publicClient) return;

    const burnTxHash = pendingObj?.burnTxHash || pendingObj?.burn_tx_hash || burnHash || "";
    const sourceChain = (pendingObj?.sourceChain || pendingObj?.source_chain || pendingObj?.fromChain || summary?.sourceChain || "Ethereum Sepolia").toString();
    const destChain = (pendingObj?.destChain || pendingObj?.destination_chain || pendingObj?.dest_chain || pendingObj?.toChain || summary?.destChain || "Arc Testnet").toString();
    const amount = (pendingObj?.amount || summary?.fromAmt || "0").toString();
    const fromAsset = (pendingObj?.fromAsset || pendingObj?.from_asset || summary?.fromAsset || "USDC").toString();
    const toAsset = (pendingObj?.toAsset || pendingObj?.to_asset || summary?.toAsset || "USDC").toString();

    const safeIncludes = (str?: string | null, target?: string) => {
      if (!str || !target) return false;
      return str.toLowerCase().includes(target.toLowerCase());
    };

    const formattedAmountStr = amount || "1";
    const assetStr = fromAsset || "USDC";

    const initial: Milestone[] = [
      { id: "appr", label: `Approve ${formattedAmountStr} ${assetStr}`, status: "done" },
      { id: "burn", label: `Burn ${formattedAmountStr} ${assetStr}`, status: "done", completedAt: nowMs() },
      { id: "attestation", label: "Iris Attestation", status: "active", startedAt: nowMs() },
      { id: "mint", label: `Mint ${formattedAmountStr} ${assetStr}`, status: "pending" },
    ];

    setMilestones(initial);
    setState("running");
    setTxHash(burnTxHash);
    setBurnHash(burnTxHash);
    setError(null);
    setSummary({ fromAmt: amount, fromAsset: fromAsset, toAsset: toAsset, type: "bridge", sourceChain, destChain, burnHash: burnTxHash });
    startTimeRef.current = nowMs();

    let ms = [...initial];
    const set = (next: Milestone[]) => { ms = next; setMilestones([...next]); };

    try {
      const rawProvider = (walletClient as any)?.transport;

      // ── Source chain verification: if burn transaction reverted, fail immediately ──
      if (!sourceChain.includes("Stellar") && !sourceChain.includes("Solana")) {
        const sourceConfig = ChainRegistry.getChainSafe(sourceChain);
        if (sourceConfig?.rpcUrl) {
          try {
            const sourceClient = createPublicClient({ transport: http(sourceConfig.rpcUrl, { timeout: 4000 }) });
            const receipt = await sourceClient.getTransactionReceipt({ hash: burnTxHash as `0x${string}` }).catch(() => null);
            if (receipt && (receipt.status === "reverted" || (receipt as any).status === "0x0")) {
              saveTxHistory({
                id: burnTxHash,
                txHash: burnTxHash,
                burnHash: burnTxHash,
                type: "bridge_cctp",
                status: "failed",
                amount: amount,
                fromAsset,
                toAsset,
                sourceChain,
                destChain,
                timestamp: Date.now(),
                userAddress: address,
                failureReason: "Burn transaction reverted on source chain"
              });
              set(failMilestone(ms, "burn"));
              setError("Burn transaction reverted on source chain. No tokens were burned.");
              setState("failed");
              return;
            }
          } catch (verifyErr) {
            console.warn("[executeResume] Source receipt verification skipped:", verifyErr);
          }
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // NATIVE RESUME FOR STELLAR FLOWS (BOTH DIRECTIONS)
      // ══════════════════════════════════════════════════════════════════════
      if (safeIncludes(destChain, "Stellar") || safeIncludes(sourceChain, "Stellar")) {
        const userAddress = address || "";

        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token || "";

          // Double claim protection check
          const url = `/api/bridge/history?wallet=${userAddress}`;
          const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          const json = await res.json();
          if (json.success && json.data) {
            const dbTx = json.data.find((tx: any) => tx.burn_tx_hash === burnTxHash);
            if (dbTx && dbTx.bridge_status === "COMPLETED") {
              clearHistoryCache(userAddress);
              setMintHash(dbTx.mint_tx_hash);
              setState("already_completed");
              set(completeMilestone(completeMilestone(ms, "attestation"), "mint", dbTx.mint_tx_hash));
              return;
            }
          }

          // ══════════════════════════════════════════════════════════════════════
          // Sync transaction with backend before claiming (in case it wasn't synced)
          // ══════════════════════════════════════════════════════════════════════
          await fetch('/api/bridge/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              wallet_address: userAddress,
              source_chain: sourceChain,
              destination_chain: destChain,
              token_symbol: fromAsset,
              amount: amount,
              burn_tx_hash: burnTxHash,
              source_address: solanaWallet.publicKey ? solanaWallet.publicKey.toBase58() : undefined
            })
          });

          // Trigger backend API to claim
          set(activateMilestone(completeMilestone(ms, "attestation"), "mint"));
          let claimRes: any;
          let claimData: any;
          for (let attempt = 0; attempt < 30; attempt++) {
            if (!isBridgeActiveRef.current) break;
            try {
              claimRes = await fetch('/api/bridge/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                  burn_tx_hash: burnTxHash,
                  source_chain: sourceChain,
                  destination_chain: destChain,
                  wallet_address: address,
                  amount
                })
              });
              claimData = await claimRes.json();
              if (claimRes.ok && claimData.success) break;
              if (claimRes.status === 409) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              break;
            } catch (fetchErr: any) {
              if (fetchErr && fetchErr.message && fetchErr.message.includes('Failed to fetch')) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              throw fetchErr;
            }
          }
          if (!claimRes || !claimData) throw new Error("VERIFICATION_TIMEOUT");
          if (!claimRes.ok || !claimData.success) {
            const err = new Error(claimData.error || "Claim failed");
            (err as any).status = claimRes.status;
            throw err;
          }

          const mintTx = claimData.mint_tx_hash;
          setMintHash(mintTx);
          set(completeMilestone(completeMilestone(ms, "attestation"), "mint", mintTx));
          setTotalMs(nowMs() - startTimeRef.current);
          setState("success");

          saveTxHistory({ id: burnTxHash, txHash: burnTxHash, burnHash: burnTxHash, mintHash: mintTx, type: "bridge_cctp", status: "success", amount: amount, fromAsset: fromAsset, toAsset: toAsset, sourceChain: sourceChain, destChain: destChain, timestamp: Date.now(), userAddress: address });
          clearHistoryCache(userAddress);
          onComplete?.();
          return;
        } catch (e: any) {
          const reason = parseRevertReason(e);
          const status = (e as any).status;
          const isAlreadyClaimed = reason.toLowerCase().includes("already claimed") || reason.toLowerCase().includes("completed");

          if (isAlreadyClaimed) {
            (process.env.NODE_ENV === "development" ? console.log : () => { })("Stellar Resume Status: Already Claimed -", reason);
          } else {
            console.error("Stellar Resume Error:", e);
          }

          if (isAlreadyClaimed) {
            try {
              const res = await fetch('/api/bridge/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  wallet_address: userAddress,
                  burn_tx_hash: burnTxHash,
                  mint_tx_hash: "ALREADY_CLAIMED_ON_CHAIN"
                })
              });

              if (!res.ok) {
                const resData = await res.json();
                throw new Error(resData.error || "Failed to sync completion status");
              }

              clearHistoryCache(userAddress);
              setState("already_completed");
              set(completeMilestone(completeMilestone(ms, "attestation"), "mint"));
              onComplete?.();
            } catch (err: any) {
              console.error("Recovery completion error:", err);
              setError(err.message || "Failed to verify completion");
              setState("failed");
              set(failMilestone(ms, "mint"));
              // Intentionally NOT calling onComplete to keep modal open for retry
            }
          } else if (status === 409 || reason.includes("VERIFICATION_TIMEOUT")) {
            setError("Circle Iris service is currently verifying block finality on-chain (~1-3 mins). Your transaction and USDC funds are 100% safe on-chain! Click Retry Claim when ready.");
            setState("attestation_pending");
            set(activateMilestone(ms, "attestation"));
            onComplete?.();
          } else {
            setError(reason);
            setState("failed");
            set(failMilestone(ms, "mint"));
            onComplete?.();
          }
          return;
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // NATIVE RESUME FOR SOLANA FLOWS (BOTH DIRECTIONS)
      // Backend relayer handles the mint — no Solana wallet connection needed.
      // ══════════════════════════════════════════════════════════════════════
      if (safeIncludes(destChain, "Solana") || safeIncludes(sourceChain, "Solana")) {
        const userAddress = address || solanaWallet?.publicKey?.toBase58() || pendingObj?.sourceAddress || "";

        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token || "";

          // Double claim protection — check if already COMPLETED in DB
          const histUrl = `/api/bridge/history?wallet=${userAddress}`;
          const histRes = await fetch(histUrl, { headers: { 'Authorization': `Bearer ${token}` } });
          const histJson = await histRes.json();
          if (histJson.success && histJson.data) {
            const dbTx = histJson.data.find((tx: any) => tx.burn_tx_hash === burnTxHash);
            if (dbTx && dbTx.bridge_status === "COMPLETED") {
              clearHistoryCache(userAddress);
              setMintHash(dbTx.mint_tx_hash);
              setState("already_completed");
              set(completeMilestone(completeMilestone(ms, "attestation"), "mint", dbTx.mint_tx_hash));
              return;
            }
          }

          // Sync the tx with backend (idempotent — safe to call even if already synced)
          await fetch('/api/bridge/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              wallet_address: userAddress,
              source_chain: sourceChain,
              destination_chain: destChain,
              token_symbol: fromAsset,
              amount: amount,
              burn_tx_hash: burnTxHash,
              source_address: pendingObj?.sourceAddress || userAddress
            })
          });

          // Poll backend claim — 30 attempts × 6s = up to 3 minutes before giving up
          set(activateMilestone(ms, "attestation"));
          let claimRes: Response | undefined;
          let claimData: any;
          let lastWas409 = false;
          for (let attempt = 0; attempt < 30; attempt++) {
            if (!isBridgeActiveRef.current) break;
            try {
              claimRes = await fetch('/api/bridge/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ burn_tx_hash: burnTxHash })
              });
              claimData = await claimRes.json();
              if (claimRes.ok && claimData.success) break;
              if (claimRes.status === 409) {
                lastWas409 = true;
                console.log("[SolanaResume] Circle Iris attestation pending (409). Attempt", attempt + 1, "/30. Retrying in 6s...");
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              lastWas409 = false;
              break;
            } catch (fetchErr: any) {
              await new Promise(r => setTimeout(r, 6000));
              continue;
            }
          }

          if (!claimRes || !claimData) {
            // Ran out of attempts but attestation was still pending — show pending UI not fail
            setError("Circle Iris service is currently verifying block finality on-chain (~1-3 mins). Your transaction and USDC funds are 100% safe on-chain! Click Retry Claim when ready.");
            setState("attestation_pending");
            set(activateMilestone(ms, "attestation"));
            onComplete?.();
            return;
          }

          if (!claimRes.ok || !claimData.success) {
            const status = claimRes.status;
            const reason = claimData?.error || "Claim failed";
            if (status === 409 || lastWas409) {
              // Still attestation pending after all attempts
              setError("Circle Iris service is currently verifying block finality on-chain (~1-3 mins). Your transaction and USDC funds are 100% safe on-chain! Click Retry Claim when ready.");
              setState("attestation_pending");
              set(activateMilestone(ms, "attestation"));
            } else {
              setError(reason);
              setState("failed");
              set(failMilestone(ms, "mint"));
            }
            onComplete?.();
            return;
          }

          const mintTx = claimData.mint_tx_hash;
          setMintHash(mintTx);
          set(completeMilestone(completeMilestone(ms, "attestation"), "mint", mintTx));
          setTotalMs(nowMs() - startTimeRef.current);
          setState("success");

          saveTxHistory({ id: burnTxHash, txHash: burnTxHash, burnHash: burnTxHash, mintHash: mintTx, type: "bridge_cctp", status: "success", amount: amount, fromAsset, toAsset, sourceChain, destChain, timestamp: Date.now(), userAddress });
          clearHistoryCache(userAddress);
          onComplete?.();
          return;
        } catch (e: any) {
          const reason = parseRevertReason(e);
          const status = (e as any).status;
          const isAlreadyClaimed = reason.toLowerCase().includes("already claimed") || reason.toLowerCase().includes("completed");

          if (isAlreadyClaimed) {
            try {
              const { data: sessionData } = await supabase.auth.getSession();
              const res = await fetch('/api/bridge/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${sessionData.session?.access_token || ''}` },
                body: JSON.stringify({ wallet_address: userAddress, burn_tx_hash: burnTxHash, mint_tx_hash: "ALREADY_CLAIMED_ON_CHAIN" })
              });
              if (res.ok) {
                clearHistoryCache(userAddress);
                setState("already_completed");
                set(completeMilestone(completeMilestone(ms, "attestation"), "mint"));
                onComplete?.();
              }
            } catch (err: any) {
              console.error("Solana resume completion error:", err);
              setError(err.message || "Failed to verify completion");
              setState("failed");
              set(failMilestone(ms, "mint"));
            }
          } else if (status === 409 || reason.includes("VERIFICATION_TIMEOUT")) {
            setError("Circle Iris service is currently verifying block finality on-chain (~1-3 mins). Your transaction and USDC funds are 100% safe on-chain! Click Retry Claim when ready.");
            setState("attestation_pending");
            set(activateMilestone(ms, "attestation"));
            onComplete?.();
          } else {
            console.error("Solana Resume Error:", e);
            setError(reason);
            setState("failed");
            set(failMilestone(ms, "mint"));
            onComplete?.();
          }
          return;
        }
      }

      const isAppKitChainResume = (chainName?: string | null) => {
        if (!chainName) return false;
        const formatted = chainName === "Ink Sepolia" ? "Ink_Testnet" : chainName === "Injective EVM Testnet" ? "Injective_Testnet" : chainName.replaceAll(" ", "_");
        const supported = getKit().getSupportedChains().map((c: any) => c.chain);
        return supported.includes(formatted);
      };

      if (fromAsset === "EURC" || fromAsset === "cirBTC" || !isAppKitChainResume(sourceChain) || !isAppKitChainResume(destChain)) {
        // ══════════════════════════════════════════════════════════════════════
        // NATIVE RESUME / RECOVER FLOW FOR CUSTOM EVM CHAINS (X Layer Testnet)
        // ══════════════════════════════════════════════════════════════════════
        const userAddress = address || solanaWallet?.publicKey?.toBase58() || stellarWallet?.address || "";

        try {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token || "";

          // Sync transaction with backend in case it wasn't synced yet
          await fetch('/api/bridge/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({
              wallet_address: userAddress,
              source_chain: sourceChain,
              destination_chain: destChain,
              token_symbol: fromAsset,
              amount: amount,
              burn_tx_hash: burnTxHash,
              source_address: solanaWallet.publicKey ? solanaWallet.publicKey.toBase58() : undefined
            })
          });

          set(activateMilestone(completeMilestone(ms, "attestation"), "mint"));

          let claimRes: any;
          let claimData: any;
          for (let attempt = 0; attempt < 30; attempt++) {
            if (!isBridgeActiveRef.current) break;
            try {
              claimRes = await fetch('/api/bridge/claim', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ burn_tx_hash: burnTxHash })
              });
              claimData = await claimRes.json();
              if (claimRes.ok && claimData.success) break;
              if (claimRes.status === 409) {
                await new Promise(r => setTimeout(r, 6000));
                continue;
              }
              break;
            } catch (fetchErr: any) {
              await new Promise(r => setTimeout(r, 6000));
              continue;
            }
          }

          if (!claimRes || !claimData) throw new Error("VERIFICATION_TIMEOUT");
          if (!claimRes.ok || !claimData.success) {
            const err = new Error(claimData.error || "Claim failed");
            (err as any).status = claimRes.status;
            throw err;
          }

          const mintTx = claimData.mint_tx_hash;
          setMintHash(mintTx);
          set(completeMilestone(completeMilestone(ms, "attestation"), "mint", mintTx));
          setTotalMs(nowMs() - startTimeRef.current);
          setState("success");

          saveTxHistory({
            id: burnTxHash,
            txHash: burnTxHash,
            burnHash: burnTxHash,
            mintHash: mintTx,
            type: "bridge_cctp",
            status: "success",
            amount: amount,
            fromAsset: fromAsset,
            toAsset: toAsset,
            sourceChain: sourceChain,
            destChain: destChain,
            timestamp: Date.now(),
            userAddress
          });

          clearHistoryCache(userAddress);
          onComplete?.();
          return;
        } catch (e: any) {
          const reason = parseRevertReason(e);
          const status = (e as any).status;
          if (status === 409 || reason.includes("VERIFICATION_TIMEOUT")) {
            setError("Circle Iris service is currently verifying block finality on-chain (~1-3 mins). Your transaction and USDC funds are 100% safe on-chain! Click Retry Claim when ready.");
            setState("attestation_pending");
            set(activateMilestone(ms, "attestation"));
          } else {
            setError(reason);
            setState("failed");
            set(failMilestone(ms, "mint"));
          }
          onComplete?.();
          return;
        }
      }

      // ══════════════════════════════════════════════════════════════════════
      // DEFAULT APP KIT RESUME (EVM <-> SOLANA)
      // ══════════════════════════════════════════════════════════════════════
      const resolveAdapter = async (chainName?: string | null) => {
        const safeName = chainName || "";
        if (safeIncludes(safeName, "solana")) {
          if (!solanaWallet || !solanaWallet.publicKey) throw new Error("Solana wallet not connected.");
          const provider = solanaWallet.wallet?.adapter || solanaWallet;
          if ((provider as any).isConnected === undefined && (provider as any).connected !== undefined) {
            (provider as any).isConnected = (provider as any).connected;
          }
          const targetChain = safeIncludes(safeName, "Devnet") ? SolanaDevnet : Solana;
          return await createSolanaAdapterFromProvider({
            provider: provider as any,
            capabilities: {
              supportedChains: [targetChain]
            }
          });
        } else {
          if (!rawProvider) throw new Error("EVM wallet provider not found.");
          const CHAIN_RPC_OVERRIDES_RESUME: Record<number, string[]> = {
            1439: [
              "https://k8s.testnet.json-rpc.injective.network/",
              "https://injectiveevm-testnet-rpc.polkachu.com"
            ],
          };
          return await createViemAdapterFromProvider({
            provider: rawProvider,
            // @ts-ignore - Viem v1/v2 PublicClient mismatch with adapter
            getPublicClient: ({ chain }: any) => {
              let transport;
              if (chain.id === 5042002) {
                transport = fallback([
                  http(process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || "https://5042002.rpc.thirdweb.com", { retryCount: 2, retryDelay: 500, batch: true }),
                  http("https://5042002.rpc.thirdweb.com", { retryCount: 2, retryDelay: 500, batch: true })
                ]);
              } else {
                const defaultRpc = chain.rpcEndpoints?.[0] ?? chain.rpcUrls?.default?.http?.[0] ?? "NO_RPC";
                const rpcs = CHAIN_RPC_OVERRIDES_RESUME[chain.id] ?? [defaultRpc];
                const isBatchSupported = chain.id !== 1439;
                transport = fallback(
                  rpcs.map(url => http(url, { retryCount: 3, retryDelay: 1000, batch: isBatchSupported }))
                );
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
                pollingInterval: 5000, // Matches Circle-recommended 5s polling for Arc Testnet
              });
            },
            capabilities: {
              supportedChains: getKit().getSupportedChains().filter((c: any) => c.type === 'evm') as any
            }
          });
        }
      };

      const sourceAdapter = await resolveAdapter(sourceChain);
      const destAdapter = await resolveAdapter(destChain);

      const formatChain = (chainName?: string | null) => {
        if (!chainName) return "";
        if (chainName === "Ink Sepolia") return "Ink_Testnet";
        if (chainName === "Injective EVM Testnet") return "Injective_Testnet";
        if (chainName === "Solana Mainnet" || chainName === "Solana") return "Solana";
        return chainName.replaceAll(" ", "_");
      };

      const supportedChains = getKit().getSupportedChains();

      const sourceChainDef = supportedChains.find((c: any) =>
        (c?.name && c.name === sourceChain) || (c?.chain && c.chain === formatChain(sourceChain))
      );
      const destChainDef = supportedChains.find((c: any) =>
        (c?.name && c.name === destChain) || (c?.chain && c.chain === formatChain(destChain))
      );

      if (!sourceChainDef || !destChainDef) {
        throw new Error(`Failed to resolve full ChainDefinition for ${sourceChain} or ${destChain}`);
      }

      const getFallbackAddress = (chainName?: string | null) => {
        if (!chainName) return address || "";
        if (safeIncludes(chainName, "Solana")) return solanaWallet?.publicKey?.toBase58() || "";
        if (safeIncludes(chainName, "Stellar")) return stellarWallet?.address || "";
        return address || "";
      };

      const userAddress = getFallbackAddress(sourceChain);

      // --- PHASE 5: DOUBLE CLAIM PROTECTION ---
      try {
        const url = `/api/bridge/history?wallet=${userAddress}`;
        const { data: sessionData } = await supabase.auth.getSession();
        const res = await fetch(url, {
          headers: { 'Authorization': `Bearer ${sessionData.session?.access_token || ''}` }
        });
        const json = await res.json();
        if (json.success && json.data) {
          const dbTx = json.data.find((tx: any) => tx.burn_tx_hash === burnTxHash);
          if (dbTx && dbTx.bridge_status === "COMPLETED") {
            clearHistoryCache(userAddress);
            setMintHash(dbTx.mint_tx_hash);
            setState("already_completed");
            set(completeMilestone(completeMilestone(ms, "attestation"), "mint", dbTx.mint_tx_hash));
            return;
          }
        }
      } catch (checkErr) {
        console.warn("Pre-flight status check failed:", checkErr);
      }
      // ----------------------------------------

      const mockResult = {
        state: "error",
        provider: "CCTPV2BridgingProvider",
        token: "USDC",
        amount: amount || "0",
        source: {
          address: pendingObj?.sourceAddress || getFallbackAddress(sourceChain),
          chain: sourceChainDef
        },
        destination: {
          address: pendingObj?.destAddress || getFallbackAddress(destChain),
          chain: destChainDef
        },
        steps: [
          { name: "approve", state: "success", txHash: "0x0" },
          { name: "burn", state: "success", txHash: burnTxHash }
        ],
        txHash: burnTxHash
      };

      const retryContext = {
        from: sourceAdapter as any,
        to: destAdapter as any
      };

      (process.env.NODE_ENV === "development" ? console.log : () => { })("=========================================");
      (process.env.NODE_ENV === "development" ? console.log : () => { })("🔄 RESUME FLOW INITIATED");
      (process.env.NODE_ENV === "development" ? console.log : () => { })("=> Target Hash:", burnTxHash);
      (process.env.NODE_ENV === "development" ? console.log : () => { })("=> Payload 1 (BridgeResult):", JSON.stringify(mockResult, null, 2));
      (process.env.NODE_ENV === "development" ? console.log : () => { })("RETRY CONTEXT FROM KEYS", Object.keys(retryContext.from));
      (process.env.NODE_ENV === "development" ? console.log : () => { })("HAS PREPARE", typeof retryContext.from.prepare);
      (process.env.NODE_ENV === "development" ? console.log : () => { })("HAS WAIT_FOR_TX", typeof retryContext.from.waitForTransaction);
      (process.env.NODE_ENV === "development" ? console.log : () => { })("=> Receipt Lookup via retryBridge() commencing...");
      (process.env.NODE_ENV === "development" ? console.log : () => { })("=========================================");

      const retryTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("VERIFICATION_TIMEOUT")), 60000)
      );

      const result = await Promise.race([
        getKit().retryBridge(
          mockResult as any,
          retryContext as any
        ),
        retryTimeout
      ]);

      if (result.state !== "success") {
        const errorStep = result.steps?.find((s: any) => s.state === "error");
        throw new Error((errorStep?.error as any)?.message || "Bridge execution returned an error state.");
      }

      const mintTx = result.steps?.find((s: any) => s.name === "mint" || s.action === "bridge:mint")?.txHash;
      if (!mintTx) {
        throw new Error("Bridge Not Confirmed");
      }

      setMintHash(mintTx);

      set(completeMilestone(completeMilestone(ms, "attestation"), "mint", mintTx));
      setState("success");

      saveTxHistory({ id: burnTxHash, txHash: burnTxHash, burnHash: burnTxHash, mintHash: mintTx, type: "bridge_cctp", status: "success", amount: amount, fromAsset: fromAsset, toAsset: toAsset, sourceChain: sourceChain, destChain: destChain, timestamp: Date.now(), userAddress: address });

      fetch('/api/bridge/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: address,
          burn_tx_hash: burnTxHash,
          mint_tx_hash: mintTx
        })
      }).then((res) => {
        if (res.ok) {
          clearHistoryCache(address);
          onComplete?.();
        } else {
          console.error("API resume bridge update failed with status:", res.status);
        }
      }).catch(err => console.error("API resume bridge update error:", err));
    } catch (e: unknown) {
      let underlyingError = e;
      if (e && typeof e === 'object') {
        const steps = (e as any).steps || (e as any).details?.steps || [];
        const errorStep = steps.find((s: any) => s.state === "error" || s.error);
        if (errorStep?.error) {
          underlyingError = errorStep.error;
        }
      }

      const reason = parseRevertReason(underlyingError);
      const isAlreadyClaimed = reason.toLowerCase().includes("nonce already used") ||
        reason.toLowerCase().includes("already claimed") ||
        reason.toLowerCase().includes("already processed") ||
        reason.toLowerCase().includes("mint already executed") ||
        reason.toLowerCase().includes("bridge completed") ||
        reason.toLowerCase().includes("message already received");

      if (isAlreadyClaimed) {
        (process.env.NODE_ENV === "development" ? console.log : () => { })("Bridge Resume Status: Already Claimed -", reason);
      } else {
        console.error("Bridge Resume Error:", e);
      }

      if (isAlreadyClaimed) {
        try {
          const res = await fetch('/api/bridge/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallet_address: address,
              burn_tx_hash: burnTxHash,
              mint_tx_hash: "ALREADY_CLAIMED_ON_CHAIN"
            })
          });

          if (!res.ok) {
            const resData = await res.json();
            throw new Error(resData.error || "Failed to sync completion status");
          }

          clearHistoryCache(address);
          setState("already_completed");
          set(completeMilestone(completeMilestone(ms, "attestation"), "mint"));
          onComplete?.();
        } catch (err: any) {
          console.error("Recovery completion error:", err);
          setError(err.message || "Failed to verify completion");
          setState("failed");
          const failedIdx = ms.findIndex((m) => m.status === "active");
          if (failedIdx !== -1) set(failMilestone(ms, ms[failedIdx].id));
          // Intentionally NOT calling onComplete to keep modal open for retry
        }
      } else {
        const isUserRejection = isUserWalletRejection(underlyingError);

        if (isUserRejection) {
          setError("Mint prompt was cancelled in your wallet. Your funds remain safe on-chain and claimable.");
          setState("mint_rejected");
          if (burnTxHash) {
            fetch('/api/bridge/claim', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                burn_tx_hash: burnTxHash,
                action: 'cancel_mint',
                wallet_address: address,
              }),
            }).catch(console.error);

            clearHistoryCache(address);
          }
        } else {
          const isTimeout = String(reason).includes("VERIFICATION_TIMEOUT") || String((underlyingError as any)?.message).includes("VERIFICATION_TIMEOUT");
          if (isTimeout) {
            setError("Circle Iris service is currently verifying block finality on-chain (~1-3 mins). Your transaction and USDC funds are 100% safe on-chain! Click Retry Claim when ready.");
            setState("attestation_pending");
            setMilestones((prev) => activateMilestone(prev, "attestation"));
          } else {
            setError(reason);
            setState("failed");
            const failedIdx = ms.findIndex((m) => m.status === "active");
            if (failedIdx !== -1) set(failMilestone(ms, ms[failedIdx].id));
            else set(failMilestone(ms, "mint"));

            fetch('/api/bridge/fail', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                wallet_address: address,
                burn_tx_hash: pendingObj.burnTxHash,
                failure_reason: "RETRY_FAILED"
              })
            }).catch(console.error);
          }
        }
        onComplete?.();
      }
    } finally {
      isBridgeActiveRef.current = false;
    }
  }, [publicClient, walletClient, address, solanaWallet, stellarWallet]);

  return {
    state,
    milestones,
    txHash,
    burnHash,
    mintHash,
    error,
    totalMs,
    blockNumber,
    summary,
    gasUsed,
    gasPricePaid,
    executeBridge,
    executeResume,
    executeManualClaim,
    manualClaimPayload,
    dismiss: reset,
  };
}
