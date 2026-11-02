import { NextResponse } from "next/server";
import { getCctpGasSettings } from "@/lib/bridge/cctp-gas-settings";

export async function GET() {
  try {
    const settings = await getCctpGasSettings();
    return NextResponse.json({
      success: true,
      settings: {
        min_relayer_balance_usd: settings.minRelayerBalanceUsd,
        max_sponsored_claim_fee_usd: settings.maxSponsoredClaimFeeUsd,
        updated_at: settings.updatedAt,
        updated_by: settings.updatedBy,
      },
    });
  } catch (error: any) {
    console.error("[CCTP Gas Settings GET API] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch settings" },
      { status: 500 }
    );
  }
}

