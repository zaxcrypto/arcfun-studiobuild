import { NextResponse } from "next/server";
import { isMainnetFeatureEnabled } from "@/config/network-modes";
import { getMainnetReadiness } from "@/lib/mainnet-readiness";
import { isAdmin } from "@/lib/admin";
import { getMainnetAccessMode } from "@/lib/mainnet-access";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const address = searchParams.get("address") || undefined;
  const userIsAdmin = isAdmin(address);

  // Check database-controlled Mainnet access policy (Open To Everyone vs Admin Only)
  const accessMode = await getMainnetAccessMode();
  const isOpenToEveryone = accessMode === "open_to_everyone";

  // Globally enabled if open to everyone or feature flag is on
  const isGloballyEnabled = isOpenToEveryone || isMainnetFeatureEnabled();
  
  // Enabled for this caller if open globally or user is admin
  const isEnabled = isGloballyEnabled || userIsAdmin;

  const readiness = getMainnetReadiness(isEnabled);
  const isReady = readiness.ready || (userIsAdmin && readiness.missing.length === 0);

  return NextResponse.json({
    mainnetEnabled: isEnabled,
    mainnetReady: isReady,
    mainnetAccessMode: accessMode,
    isOpenToEveryone,
    isAdmin: userIsAdmin,
    missing: readiness.missing,
    supportedChains: {
      testnet: ["Arc Testnet", "Solana Devnet"],
      mainnet: isEnabled ? [
        "Arc Mainnet", "Base Mainnet", "Arbitrum Mainnet", "Ethereum Mainnet",
        "OP Mainnet", "Polygon Mainnet", "Avalanche Mainnet", "Sonic Mainnet",
        "Ink Mainnet", "Unichain Mainnet", "Linea Mainnet", "Solana Mainnet"
      ] : [],
    },
    defaultNetwork: "testnet",
  });
}
