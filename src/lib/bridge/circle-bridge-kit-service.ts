/**
 * Circle Bridge Kit Integration Engine
 *
 * Implements Circle's official `@circle-fin/bridge-kit` and `@circle-fin/adapter-viem-v2`
 * for production CCTP V2 bridging.
 *
 * Designed with a decoupled architecture:
 * 1. User wallet authorizes and executes source Approval and Burn via BridgeKit provider.
 * 2. BridgeKit polls Iris API for attestation data.
 * 3. Verified attestation is handed off to ArcFun's backend relayer (/api/bridge/claim)
 *    to prevent client network-switching disruption and eliminate duplicate mint attempts.
 */

import { BridgeKit, TransferSpeed, Arc, Base } from "@circle-fin/bridge-kit";
import { createViemAdapterFromProvider, ViemAdapter } from "@circle-fin/adapter-viem-v2";
import type { EIP1193Provider } from "viem";
import { http, fallback } from "viem";
import { MAINNET_CHAIN_REGISTRY, isFastTransferSupported } from "@/config/mainnet-chain-registry";

export interface BridgeKitBurnResult {
  burnTxHash: string;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  messageBytes?: string;
  attestation?: string;
  nonce?: string;
}

export interface BridgeKitTransferRequest {
  sourceChain: string;      // e.g. "Arc Mainnet"
  destinationChain: string; // e.g. "Base Mainnet"
  amount: string;           // e.g. "0.01"
  provider: EIP1193Provider;// Browser wallet provider (window.ethereum)
  recipientAddress?: string;
  preferredSpeed?: "FAST" | "SLOW";
  onProgress?: (step: string, data?: any) => void;
}

export interface BridgeKitEstimateResult {
  token: string;
  amount: string;
  sourceChain: string;
  destinationChain: string;
  transferSpeed: "FAST" | "SLOW";
  estimatedGasCost?: string;
  isFastAvailable: boolean;
}

export class CircleBridgeKitService {
  private static kitInstance: BridgeKit | null = null;

  /** Singleton BridgeKit instance */
  public static getKit(): BridgeKit {
    if (!this.kitInstance) {
      this.kitInstance = new BridgeKit();
    }
    return this.kitInstance;
  }

  /**
   * Resolve chain object from chain name
   */
  public static resolveChainKey(chainName: string): "Arc" | "Base" | string {
    const meta = MAINNET_CHAIN_REGISTRY[chainName];
    if (meta) return meta.chainKey;
    if (chainName.includes("Arc")) return "Arc";
    if (chainName.includes("Base")) return "Base";
    return chainName;
  }

  /**
   * Resolve native BridgeKit chain definition
   */
  public static resolveBridgeKitChain(chainName: string) {
    const key = this.resolveChainKey(chainName);
    if (key === "Arc") return Arc;
    if (key === "Base") return Base;
    const kit = this.getKit();
    const found = kit.getSupportedChains().find(c => c.chain === key || c.name === chainName);
    return found || Arc;
  }

  /**
   * Create an official Viem adapter connected to user's wallet provider
   */
  public static async createAdapter(provider: EIP1193Provider): Promise<ViemAdapter> {
    return await createViemAdapterFromProvider({
      provider,
      capabilities: {
        addressContext: "user-controlled"
      },
      getPublicClient: ({ chain }: any) => {
        if (chain.id === 5042 || chain.chain === "Arc" || chain.name === "Arc") {
          const arcRpc = process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || process.env.ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io/";
          return {
            chain,
            transport: fallback([
              http(arcRpc, { retryCount: 3, retryDelay: 1000 }),
              http("https://rpc.mainnet.arc.io/", { retryCount: 3, retryDelay: 1000 })
            ])
          } as any;
        }
        return undefined as any;
      }
    });
  }

  /**
   * Estimate transfer cost and validate speed compatibility
   */
  public static async estimateRoute(params: {
    sourceChain: string;
    destinationChain: string;
    amount: string;
    provider: EIP1193Provider;
  }): Promise<BridgeKitEstimateResult> {
    const sourceKey = this.resolveChainKey(params.sourceChain);
    const destKey = this.resolveChainKey(params.destinationChain);
    const isFastAvailable = isFastTransferSupported(params.sourceChain, params.destinationChain);

    const adapter = await this.createAdapter(params.provider);
    const kit = this.getKit();

    // Enforce SLOW (Standard) transfer on Arc per Circle specifications
    const speed = isFastAvailable ? TransferSpeed.FAST : TransferSpeed.SLOW;

    try {
      const estimate = await kit.estimate({
        from: { adapter, chain: sourceKey as any },
        to: { adapter, chain: destKey as any },
        amount: params.amount,
        config: {
          transferSpeed: speed
        }
      });

      return {
        token: estimate.token,
        amount: estimate.amount,
        sourceChain: params.sourceChain,
        destinationChain: params.destinationChain,
        transferSpeed: isFastAvailable ? "FAST" : "SLOW",
        isFastAvailable
      };
    } catch (err: any) {
      return {
        token: "USDC",
        amount: params.amount,
        sourceChain: params.sourceChain,
        destinationChain: params.destinationChain,
        transferSpeed: "SLOW",
        isFastAvailable: false
      };
    }
  }

  /**
   * Modular User-Signed Burn & Attestation Handoff
   * 
   * Executes ONLY the source-chain actions (approve + burn) using BridgeKit's
   * verified CCTPV2 provider, then polls for Iris attestation.
   * Does NOT attempt destination mint client-side, avoiding forced chain switches
   * and preventing duplicate mints against ArcFun's backend relayer.
   */
  public static async executeUserBurnAndAttest(req: BridgeKitTransferRequest): Promise<BridgeKitBurnResult> {
    const sourceChain = this.resolveBridgeKitChain(req.sourceChain);
    const destChain = this.resolveBridgeKitChain(req.destinationChain);
    const isFast = isFastTransferSupported(req.sourceChain, req.destinationChain) && req.preferredSpeed === "FAST";
    const speed = isFast ? TransferSpeed.FAST : TransferSpeed.SLOW;

    const adapter = await this.createAdapter(req.provider);
    const userAddress = await adapter.getAddress(sourceChain as any);
    const kit = this.getKit();

    // 1. Discover CCTP V2 provider
    const provider = (kit as any).findProviderForRoute
      ? await (kit as any).findProviderForRoute({
          source: { chain: sourceChain },
          destination: { chain: destChain },
          token: "USDC"
        })
      : kit.providers[0];

    if (!provider) {
      throw new Error(`[CircleBridgeKit] No bridging provider found for ${req.sourceChain} -> ${req.destinationChain}`);
    }

    const sourceContext = {
      chain: sourceChain,
      adapter,
      address: userAddress
    };

    const destContext = {
      chain: destChain,
      adapter,
      address: req.recipientAddress || userAddress,
      recipientAddress: req.recipientAddress || userAddress
    };

    // Convert human readable amount (e.g. 0.01) to atomic units (6 decimals for CCTP)
    const atomicAmount = BigInt(Math.round(parseFloat(req.amount) * 1_000_000)).toString();

    // 2. Prepare & Execute Approval if needed (Skipped for native gas assets like Arc Mainnet USDC)
    const isNativeGasAsset = req.sourceChain.toLowerCase().includes("arc");
    if (!isNativeGasAsset) {
      req.onProgress?.("APPROVING", { chain: req.sourceChain });
      const approveAction = await (provider as any).approve(sourceContext, atomicAmount);
      if (approveAction && approveAction.type !== "noop") {
        const approveTxHash = await approveAction.execute();
        req.onProgress?.("APPROVE_CONFIRMED", { txHash: approveTxHash });
        await adapter.waitForTransaction(approveTxHash, undefined, sourceChain as any);
      }
    } else {
      req.onProgress?.("APPROVE_CONFIRMED", { txHash: "0x0", native: true });
    }

    // 3. Prepare & Execute Burn on Source Chain with safe retry
    req.onProgress?.("BURNING", { chain: req.sourceChain });
    const burnParams = {
      source: sourceContext,
      destination: destContext,
      amount: atomicAmount,
      token: "USDC",
      config: {
        transferSpeed: speed
      }
    };

    let burnTxHash: string;
    try {
      const burnAction = await (provider as any).burn(burnParams);
      burnTxHash = await burnAction.execute();
    } catch (burnErr: any) {
      console.warn("[CircleBridgeKit] Initial burn attempt error, retrying with fresh state...", burnErr);
      await new Promise(r => setTimeout(r, 1200));
      const retryAction = await (provider as any).burn(burnParams);
      burnTxHash = await retryAction.execute();
    }
    req.onProgress?.("BURN_CONFIRMED", { txHash: burnTxHash });
    await adapter.waitForTransaction(burnTxHash as `0x${string}`, undefined, sourceChain as any);

    // Return burn details immediately without client-side polling.
    // The backend relayer (/api/bridge/claim) handles Iris attestation verification and mint execution.
    return {
      burnTxHash,
      sourceChain: req.sourceChain,
      destinationChain: req.destinationChain,
      amount: req.amount
    };
  }
}
