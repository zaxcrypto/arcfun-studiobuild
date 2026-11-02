export const PRIMARY_SOLANA_DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
export const FALLBACK_SOLANA_DEVNET_RPC = "https://api.devnet.solana.com";

export const PRIMARY_SOLANA_MAINNET_RPC = process.env.NEXT_PUBLIC_SOLANA_MAINNET_RPC_URL || process.env.SOLANA_MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com";
export const FALLBACK_SOLANA_MAINNET_RPC = process.env.SOLANA_MAINNET_FALLBACK_RPC_URL || "https://solana-rpc.publicnode.com";

// Legacy exports for backwards compatibility with existing devnet callers
export const PRIMARY_SOLANA_RPC = PRIMARY_SOLANA_DEVNET_RPC;
export const FALLBACK_SOLANA_RPC = FALLBACK_SOLANA_DEVNET_RPC;

export function getSolanaRpcUrl(isMainnet: boolean = false): string {
  return isMainnet ? PRIMARY_SOLANA_MAINNET_RPC : PRIMARY_SOLANA_DEVNET_RPC;
}

export function getSolanaFallbackRpcUrl(isMainnet: boolean = false): string {
  return isMainnet ? FALLBACK_SOLANA_MAINNET_RPC : FALLBACK_SOLANA_DEVNET_RPC;
}

/**
 * Executes a given operation using the primary RPC for the target network.
 * If it fails, times out, or returns invalid data, it automatically retries with the fallback RPC.
 */
export async function withSolanaFailover<T>(
  operation: (rpcUrl: string) => Promise<T>,
  context: string = "RPC Operation",
  isMainnet: boolean = false
): Promise<T> {
  const primaryRpc = isMainnet ? PRIMARY_SOLANA_MAINNET_RPC : PRIMARY_SOLANA_DEVNET_RPC;
  const fallbackRpc = isMainnet ? FALLBACK_SOLANA_MAINNET_RPC : FALLBACK_SOLANA_DEVNET_RPC;

  try {
    return await operation(primaryRpc);
  } catch (error) {
    console.warn(`[Solana RPC Failover] ${context} failed on primary RPC (${primaryRpc}). Retrying with fallback...`, error);
    try {
      return await operation(fallbackRpc);
    } catch (fallbackError) {
      console.error(`[Solana RPC Failover] ${context} failed on fallback RPC (${fallbackRpc}) as well.`, fallbackError);
      throw fallbackError;
    }
  }
}
