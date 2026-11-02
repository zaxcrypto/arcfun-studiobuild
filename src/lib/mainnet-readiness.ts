/**
 * Mainnet Readiness & Verification Engine
 * Enforces fail-closed safety: Mainnet cannot be activated unless
 * explicitly enabled and all required configurations exist.
 */

export interface MainnetReadiness {
  enabled: boolean;
  missing: string[];
  ready: boolean;
}

const REQUIRED_MAINNET_VARS = [
  "NEXT_PUBLIC_ARC_MAINNET_RPC_URL",
  "NEXT_PUBLIC_BASE_MAINNET_RPC_URL",
  "NEXT_PUBLIC_ARB_MAINNET_RPC_URL",
] as const;

export function getMainnetReadiness(): MainnetReadiness {
  const enabled = (
    process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED === "true" ||
    process.env.ARCFUN_MAINNET_ENABLED === "true"
  );

  const missing: string[] = [];
  if (enabled) {
    for (const v of REQUIRED_MAINNET_VARS) {
      const val = process.env[v]?.trim();
      if (!val) {
        missing.push(v);
      }
    }
  }

  return {
    enabled,
    missing,
    ready: enabled && missing.length === 0,
  };
}

