import { createPublicClient, createWalletClient, http, encodeFunctionData, parseUnits, formatUnits, padHex, isAddress, ByteArray, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcMainnet } from "@/config/extra-chains";
import { base } from "viem/chains";

/**
 * Circle CCTP V2 Mainnet Backend Client
 * Pure, reliable, backend-only orchestrator for Arc Mainnet <-> Base Mainnet
 */

export const CCTP_MAINNET_CONFIG = {
  arc: {
    domain: 26,
    chainId: 5042,
    usdc: "0x3600000000000000000000000000000000000000" as const,
    tokenMessengerV2: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as const,
    messageTransmitterV2: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const,
    rpcUrl: process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || "https://rpc.mainnet.arc.io",
  },
  base: {
    domain: 6,
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const,
    tokenMessengerV2: "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d" as const,
    messageTransmitterV2: "0x81D40F21F12A8F0E3252Bccb954D722d4c464B64" as const,
    rpcUrl: process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL || "https://mainnet.base.org",
  },
  irisApi: "https://iris-api.circle.com",
} as const;

export const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export const TOKEN_MESSENGER_ABI = [
  {
    name: "depositForBurn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

export const MESSAGE_TRANSMITTER_ABI = [
  {
    name: "receiveMessage",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "message", type: "bytes" },
      { name: "attestation", type: "bytes" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

export interface CctpDryRunResult {
  deployerAddress: string;
  sourceChain: "Arc Mainnet";
  destinationChain: "Base Mainnet";
  amountUSDC: string;
  sourceUsdcBalance: string;
  sourceNativeGasBalance: string;
  destinationRecipient: string;
  destinationDomain: number;
  tokenMessengerAddress: string;
  approvalRequired: boolean;
  isValid: boolean;
  error?: string;
}

/**
 * Prepares dry-run parameters without broadcasting transactions
 */
export async function dryRunArcToBaseCctp(params: {
  privateKey: string;
  recipientAddress: string;
  amountUSDC: string;
}): Promise<CctpDryRunResult> {
  const { privateKey, recipientAddress, amountUSDC } = params;

  if (!isAddress(recipientAddress)) {
    throw new Error(`Invalid destination recipient address: ${recipientAddress}`);
  }

  const rawKey = privateKey.startsWith("0x") ? (privateKey as Hex) : (`0x${privateKey}` as Hex);
  const account = privateKeyToAccount(rawKey);

  const arcClient = createPublicClient({
    chain: arcMainnet,
    transport: http(CCTP_MAINNET_CONFIG.arc.rpcUrl),
  });

  const parsedAmount = parseUnits(amountUSDC, 6);

  // 1. Check native gas
  const nativeGas = await arcClient.getBalance({ address: account.address });

  // 2. Check USDC balance
  const usdcBal = await arcClient.readContract({
    address: CCTP_MAINNET_CONFIG.arc.usdc,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  // 3. Check current allowance
  const currentAllowance = await arcClient.readContract({
    address: CCTP_MAINNET_CONFIG.arc.usdc,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, CCTP_MAINNET_CONFIG.arc.tokenMessengerV2],
  });

  const approvalRequired = currentAllowance < parsedAmount;
  const hasEnoughUSDC = usdcBal >= parsedAmount;
  const hasEnoughGas = nativeGas > 0n;

  const isValid = hasEnoughUSDC && hasEnoughGas;
  let error: string | undefined;
  if (!hasEnoughUSDC) error = `Insufficient USDC balance: has ${formatUnits(usdcBal, 6)}, requires ${amountUSDC}`;
  else if (!hasEnoughGas) error = "Insufficient native gas balance on Arc Mainnet";

  return {
    deployerAddress: account.address,
    sourceChain: "Arc Mainnet",
    destinationChain: "Base Mainnet",
    amountUSDC,
    sourceUsdcBalance: formatUnits(usdcBal, 6),
    sourceNativeGasBalance: formatUnits(nativeGas, 18),
    destinationRecipient: recipientAddress,
    destinationDomain: CCTP_MAINNET_CONFIG.base.domain,
    tokenMessengerAddress: CCTP_MAINNET_CONFIG.arc.tokenMessengerV2,
    approvalRequired,
    isValid,
    error,
  };
}

/**
 * Poll Circle Iris API for CCTP V2 Attestation
 */
export async function pollCircleAttestation(
  sourceDomain: number,
  txHash: string,
  timeoutMs = 600000,
  intervalMs = 5000
): Promise<{ message: Hex; attestation: Hex }> {
  const startTime = Date.now();
  const url = `${CCTP_MAINNET_CONFIG.irisApi}/v2/messages/${sourceDomain}?transactionHash=${txHash}`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const msgObj = data?.messages?.[0];
        if (msgObj?.status === "complete" && msgObj?.attestation && msgObj?.message) {
          return {
            message: msgObj.message as Hex,
            attestation: msgObj.attestation as Hex,
          };
        }
      }
    } catch (_) {
      // transient network error, retry
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  throw new Error(`Timed out waiting for Circle attestation for tx: ${txHash}`);
}

