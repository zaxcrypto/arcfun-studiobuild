import { NextResponse } from "next/server";
import { isMainnetFeatureEnabled } from "@/config/network-modes";
import { getMainnetReadiness } from "@/lib/mainnet-readiness";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address") || undefined;
  const userIsAdmin = isAdmin(address);

  const isGloballyEnabled = isMainnetFeatureEnabled();
  // Admin-only preview access: if user is admin, allow mainnet preview access
  const isEnabled = isGloballyEnabled || userIsAdmin;

  const readiness = getMainnetReadiness();
  const isReady = readiness.ready || (userIsAdmin && readiness.missing.length === 0);

  return NextResponse.json({
    mainnetEnabled: isEnabled,
    mainnetReady: isReady,
    isAdmin: userIsAdmin,
    missing: readiness.missing,
    supportedChains: {
      testnet: ["Arc Testnet"],
      mainnet: isEnabled ? [
        "Arc Mainnet", "Base Mainnet", "Arbitrum Mainnet", "Ethereum Mainnet",
        "OP Mainnet", "Polygon Mainnet", "Avalanche Mainnet", "Sonic Mainnet",
        "Ink Mainnet", "Unichain Mainnet", "Linea Mainnet"
      ] : [],
    },
    defaultNetwork: "testnet",
  });
}
