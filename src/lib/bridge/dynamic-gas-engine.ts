import { ethers } from "ethers";
import { ChainRegistry } from "./chain-registry";
import { getCctpGasSettings, CctpGasSettings } from "./cctp-gas-settings";
import { getVerifiedNativeTokenPriceUsd } from "./chainlink-verifier";
import { getOpStackL1DataFeeWei, isOpStackChain } from "./op-stack-fees";
import { getCctpDomains, resolveCctpDomain } from "./cctp-provider";
import { isMainnetChain } from "@/config/swap-contract";

export interface DynamicGasEligibility {
  destinationChain: string;
  nativeGasSymbol: string;
  nativeDecimals: number;
  relayerAddress: string;
  relayerBalance: string;
  relayerBalanceUsd: number;
  estimatedExecutionGasUnits: string;
  gasPriceWei: string;
  estimatedL2GasFeeWei: string;
  estimatedL1DataFeeWei: string;
  totalEstimatedClaimFeeWei: string;
  totalEstimatedClaimFeeUsd: number;
  // Thresholds used
  configuredMinRelayerBalanceUsd: number;
  configuredMaxSponsoredFeeUsd: number;
  // Independent conditions
  conditionABalancePassed: boolean; // Balance >= Min
  conditionBFeePassed: boolean;     // Fee < Max
  oracleVerified: boolean;
  // Final eligibility
  isSponsoredEligible: boolean;
  isManualClaimRequired: boolean;
  manualClaimReason?: "Insufficient relayer balance" | "High network fee" | "Unable to verify network fee" | string;
  lastChecked: string;
}

// ── Cache for dynamic gas status ──────────────────────────────────────────────
interface CachedGasEligibility {
  timestamp: number;
  data: DynamicGasEligibility;
}
const eligibilityCache = new Map<string, CachedGasEligibility>();
const CACHE_TTL_MS = 30_000; // 30 seconds cache for instant verification and low RPC load

export function invalidateGasEligibilityCache(): void {
  eligibilityCache.clear();
}

/**
 * Returns the configured relayer private key for EVM chains.
 */
export function getEvmRelayerPrivateKey(): string {
  const rawKey = (
    process.env.EVM_PRIVATE_KEY ||
    process.env.DEPLOYER_PRIVATE_KEY ||
    process.env.GATEWAY_RELAYER_PRIVATE_KEY ||
    ""
  ).trim().replace(/^["']|["']$/g, "");

  if (!rawKey) {
    throw new Error("EVM relayer private key is not configured on the server.");
  }
  return rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
}

export function getEvmRelayerAddress(): string {
  const pk = getEvmRelayerPrivateKey();
  return new ethers.Wallet(pk).address;
}

/**
 * Conservative base execution gas limit for CCTP MessageTransmitter.receiveMessage()
 * Measured on-chain: ~140k - 175k gas. We dynamically estimate or buffer to 195k with safety margin.
 */
export const CCTP_RECEIVE_MESSAGE_BASE_GAS = 195_000n;

/**
 * Core dynamic gas evaluation engine.
 * Evaluates both independent conditions using currently saved admin thresholds.
 */
export async function evaluateDynamicGasEligibility(
  destinationChain: string,
  bypassCache: boolean = false
): Promise<DynamicGasEligibility> {
  const chainName = destinationChain.trim();
  const now = Date.now();

  if (!bypassCache) {
    const cached = eligibilityCache.get(chainName);
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
  }

  // 1. Load currently active admin-configured settings
  const settings: CctpGasSettings = await getCctpGasSettings();
  const minRelayerBalanceUsd = settings.minRelayerBalanceUsd;
  const maxSponsoredFeeUsd = settings.maxSponsoredClaimFeeUsd;

  // 2. Resolve Chain Definition
  const chainConfig = ChainRegistry.getChainSafe(chainName);
  if (!chainConfig) {
    const res = createIneligibleResult(chainName, "ETH", 18, "", minRelayerBalanceUsd, maxSponsoredFeeUsd, "Unable to verify network fee");
    eligibilityCache.set(chainName, { timestamp: now, data: res });
    return res;
  }

  const nativeSymbol = chainConfig.nativeCurrency.symbol;
  const nativeDecimals = chainConfig.nativeCurrency.decimals;

  // Fast Solana Guard (Non-EVM):
  if (chainName.toLowerCase().includes("solana")) {
    const isDevnet = chainName.toLowerCase().includes("devnet");
    const solanaRpc = isDevnet
      ? (process.env.SOLANA_DEVNET_RPC_URL || "https://api.devnet.solana.com")
      : (process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL || process.env.SOLANA_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com");
    const solanaPrivateKey = isDevnet
      ? process.env.SOL_CCTP_TEST_KEY
      : (process.env.SOLANA_MAINNET_RELAYER_KEY || process.env.SOL_CCTP_TEST_KEY);

    let solanaRelayerAddress = "";
    let solanaBalanceSol = 0;
    if (solanaPrivateKey) {
      try {
        const bs58Module = await import("bs58");
        const bs58 = (bs58Module as any).default || bs58Module;
        const { Keypair, Connection } = await import("@solana/web3.js");
        const kp = Keypair.fromSecretKey(bs58.decode(solanaPrivateKey));
        solanaRelayerAddress = kp.publicKey.toBase58();
        const conn = new Connection(solanaRpc, "confirmed");
        const lamports = await conn.getBalance(kp.publicKey);
        solanaBalanceSol = lamports / 1e9;
      } catch (err) {
        console.warn("[DynamicGasEngine] Solana relayer check error:", err);
      }
    }

    const solPriceUsd = 180;
    const solanaBalanceUsd = solanaBalanceSol * solPriceUsd;
    const solanaTxFeeUsd = 0.00001 * solPriceUsd; // ~$0.0018

    const conditionABalancePassed = solanaBalanceSol >= 0.002;
    const conditionBFeePassed = solanaTxFeeUsd < maxSponsoredFeeUsd;
    const isSponsoredEligible = conditionABalancePassed && conditionBFeePassed;

    const res: DynamicGasEligibility = {
      destinationChain: chainName,
      nativeGasSymbol: "SOL",
      nativeDecimals: 9,
      relayerAddress: solanaRelayerAddress,
      relayerBalance: solanaBalanceSol.toFixed(6),
      relayerBalanceUsd: solanaBalanceUsd,
      estimatedExecutionGasUnits: "5000",
      gasPriceWei: "5000",
      estimatedL2GasFeeWei: "5000",
      estimatedL1DataFeeWei: "0",
      totalEstimatedClaimFeeWei: "5000",
      totalEstimatedClaimFeeUsd: solanaTxFeeUsd,
      configuredMinRelayerBalanceUsd: minRelayerBalanceUsd,
      configuredMaxSponsoredFeeUsd: maxSponsoredFeeUsd,
      conditionABalancePassed,
      conditionBFeePassed,
      oracleVerified: true,
      isSponsoredEligible,
      isManualClaimRequired: !isSponsoredEligible,
      manualClaimReason: !conditionABalancePassed ? "Insufficient relayer balance" : undefined,
      lastChecked: new Date().toISOString()
    };
    eligibilityCache.set(chainName, { timestamp: now, data: res });
    return res;
  }

  let relayerAddress = "";
  try {
    relayerAddress = getEvmRelayerAddress();
  } catch (err) {
    const res = createIneligibleResult(chainName, nativeSymbol, nativeDecimals, "", minRelayerBalanceUsd, maxSponsoredFeeUsd, "Insufficient relayer balance");
    eligibilityCache.set(chainName, { timestamp: now, data: res });
    return res;
  }

  // 3. Fast Ethereum Mainnet L1 Guard:
  // L1 claims typically cost $8 - $30 in Ethereum gas and must strictly require manual claim
  if (chainName === "Ethereum Mainnet") {
    const res: DynamicGasEligibility = {
      destinationChain: chainName,
      nativeGasSymbol: nativeSymbol,
      nativeDecimals,
      relayerAddress,
      relayerBalance: "0.000000",
      relayerBalanceUsd: 0,
      estimatedExecutionGasUnits: "195000",
      gasPriceWei: "0",
      estimatedL2GasFeeWei: "0",
      estimatedL1DataFeeWei: "0",
      totalEstimatedClaimFeeWei: "0",
      totalEstimatedClaimFeeUsd: 15.0,
      configuredMinRelayerBalanceUsd: minRelayerBalanceUsd,
      configuredMaxSponsoredFeeUsd: maxSponsoredFeeUsd,
      conditionABalancePassed: false,
      conditionBFeePassed: false,
      oracleVerified: true,
      isSponsoredEligible: false,
      isManualClaimRequired: true,
      manualClaimReason: "High network fee",
      lastChecked: new Date().toISOString(),
    };
    eligibilityCache.set(chainName, { timestamp: now, data: res });
    return res;
  }

  // 4. Query Verified Oracle Price
  const oracleResult = await getVerifiedNativeTokenPriceUsd(chainName);
  if (!oracleResult.valid || oracleResult.priceUsd <= 0) {
    console.warn(`[DynamicGasEngine] Oracle validation failed for ${chainName}:`, oracleResult.error);
    const res = createIneligibleResult(
      chainName,
      nativeSymbol,
      nativeDecimals,
      relayerAddress,
      minRelayerBalanceUsd,
      maxSponsoredFeeUsd,
      "Unable to verify network fee"
    );
    eligibilityCache.set(chainName, { timestamp: now, data: res });
    return res;
  }
  const nativePriceUsd = oracleResult.priceUsd;

  // 5. Query On-Chain Relayer Balance & Gas Prices via RPC
  try {
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl, undefined, { staticNetwork: true });
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("RPC timeout")), 5000)
    );

    const [balanceWei, feeData] = await Promise.race([
      Promise.all([
        provider.getBalance(relayerAddress),
        provider.getFeeData().catch(() => ({
          gasPrice: ethers.parseUnits("0.1", "gwei"),
          maxFeePerGas: null,
        })),
      ]),
      timeoutPromise,
    ]);

    const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || ethers.parseUnits("0.1", "gwei");

    // Dynamic Gas Estimation:
    // CCTP MessageTransmitter.receiveMessage() uses ~140k-175k gas.
    // CCTP_RECEIVE_MESSAGE_BASE_GAS (195,000 gas) includes a 25% safety buffer.
    const estimatedGasUnits = CCTP_RECEIVE_MESSAGE_BASE_GAS;
    const estimatedL2FeeWei = estimatedGasUnits * gasPrice;

    // 6. OP-Stack L1 Calldata Fee (Base, OP, Ink, Unichain)
    let estimatedL1FeeWei = 0n;
    if (isOpStackChain(chainName)) {
      estimatedL1FeeWei = await getOpStackL1DataFeeWei(chainName, provider).catch(() => 0n);
    }

    const totalFeeWei = estimatedL2FeeWei + estimatedL1FeeWei;

    // Convert values to USD
    const balanceUnits = parseFloat(ethers.formatUnits(balanceWei, nativeDecimals));
    const relayerBalanceUsd = balanceUnits * nativePriceUsd;

    const totalFeeUnits = parseFloat(ethers.formatUnits(totalFeeWei, nativeDecimals));
    const totalEstimatedClaimFeeUsd = totalFeeUnits * nativePriceUsd;

    // ─── 7. Evaluate Independent Conditions ──────────────────────────────────
    // Condition A: Minimum backend relayer balance (Default $2.00)
    // If balance < configured minimum -> force Manual Claim ON
    const conditionABalancePassed = relayerBalanceUsd >= minRelayerBalanceUsd;

    // Condition B: Maximum sponsored claim transaction fee (Default $0.10)
    // If fee >= configured maximum -> force Manual Claim ON
    const conditionBFeePassed = totalEstimatedClaimFeeUsd < maxSponsoredFeeUsd;

    const isSponsoredEligible = conditionABalancePassed && conditionBFeePassed;
    const isManualClaimRequired = !isSponsoredEligible;

    let manualClaimReason: DynamicGasEligibility["manualClaimReason"] = undefined;
    if (isManualClaimRequired) {
      if (!conditionABalancePassed && !conditionBFeePassed) {
        // Both triggered: prioritize Insufficient relayer balance as primary root constraint
        manualClaimReason = "Insufficient relayer balance";
      } else if (!conditionABalancePassed) {
        manualClaimReason = "Insufficient relayer balance";
      } else if (!conditionBFeePassed) {
        manualClaimReason = "High network fee";
      }
    }

    const result: DynamicGasEligibility = {
      destinationChain: chainName,
      nativeGasSymbol: nativeSymbol,
      nativeDecimals,
      relayerAddress,
      relayerBalance: balanceUnits.toFixed(6),
      relayerBalanceUsd: parseFloat(relayerBalanceUsd.toFixed(4)),
      estimatedExecutionGasUnits: estimatedGasUnits.toString(),
      gasPriceWei: gasPrice.toString(),
      estimatedL2GasFeeWei: estimatedL2FeeWei.toString(),
      estimatedL1DataFeeWei: estimatedL1FeeWei.toString(),
      totalEstimatedClaimFeeWei: totalFeeWei.toString(),
      totalEstimatedClaimFeeUsd: parseFloat(totalEstimatedClaimFeeUsd.toFixed(4)),
      configuredMinRelayerBalanceUsd: minRelayerBalanceUsd,
      configuredMaxSponsoredFeeUsd: maxSponsoredFeeUsd,
      conditionABalancePassed,
      conditionBFeePassed,
      oracleVerified: true,
      isSponsoredEligible,
      isManualClaimRequired,
      manualClaimReason,
      lastChecked: new Date().toISOString(),
    };

    eligibilityCache.set(chainName, { timestamp: now, data: result });
    return result;
  } catch (rpcErr: any) {
    console.warn(`[DynamicGasEngine] RPC check failed on ${chainName}:`, rpcErr?.message || rpcErr);
    const res = createIneligibleResult(
      chainName,
      nativeSymbol,
      nativeDecimals,
      relayerAddress,
      minRelayerBalanceUsd,
      maxSponsoredFeeUsd,
      "Unable to verify network fee"
    );
    eligibilityCache.set(chainName, { timestamp: now, data: res });
    return res;
  }
}

function createIneligibleResult(
  destinationChain: string,
  nativeGasSymbol: string,
  nativeDecimals: number,
  relayerAddress: string,
  configuredMinRelayerBalanceUsd: number,
  configuredMaxSponsoredFeeUsd: number,
  reason: "Insufficient relayer balance" | "High network fee" | "Unable to verify network fee"
): DynamicGasEligibility {
  return {
    destinationChain,
    nativeGasSymbol,
    nativeDecimals,
    relayerAddress,
    relayerBalance: "0.000000",
    relayerBalanceUsd: 0,
    estimatedExecutionGasUnits: "195000",
    gasPriceWei: "0",
    estimatedL2GasFeeWei: "0",
    estimatedL1DataFeeWei: "0",
    totalEstimatedClaimFeeWei: "0",
    totalEstimatedClaimFeeUsd: 0,
    configuredMinRelayerBalanceUsd,
    configuredMaxSponsoredFeeUsd,
    conditionABalancePassed: false,
    conditionBFeePassed: false,
    oracleVerified: false,
    isSponsoredEligible: false,
    isManualClaimRequired: true,
    manualClaimReason: reason,
    lastChecked: new Date().toISOString(),
  };
}

