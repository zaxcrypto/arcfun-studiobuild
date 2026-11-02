import { NextRequest, NextResponse } from "next/server";
import { evaluateDynamicGasEligibility } from "@/lib/bridge/dynamic-gas-engine";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const destinationChain = searchParams.get("destinationChain") || searchParams.get("destination_chain") || searchParams.get("chain");
    const bypassCache = searchParams.get("bypassCache") === "true";

    if (!destinationChain) {
      return NextResponse.json(
        { error: "Missing required query parameter: destinationChain" },
        { status: 400 }
      );
    }

    const eligibility = await evaluateDynamicGasEligibility(destinationChain, bypassCache);

    return NextResponse.json({
      success: true,
      eligibility,
    });
  } catch (error: any) {
    console.error("[CCTP Gas Eligibility API] Error evaluating gas eligibility:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to evaluate gas eligibility",
        // Safe fallback in response
        eligibility: {
          destinationChain: req.nextUrl.searchParams.get("destinationChain") || "unknown",
          isSponsoredEligible: false,
          isManualClaimRequired: true,
          manualClaimReason: "Unable to verify network fee",
        },
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const destinationChain = body.destinationChain || body.destination_chain || body.chain;
    const bypassCache = body.bypassCache === true;

    if (!destinationChain) {
      return NextResponse.json(
        { error: "Missing required body parameter: destinationChain" },
        { status: 400 }
      );
    }

    const eligibility = await evaluateDynamicGasEligibility(destinationChain, bypassCache);

    return NextResponse.json({
      success: true,
      eligibility,
    });
  } catch (error: any) {
    console.error("[CCTP Gas Eligibility API] Error evaluating gas eligibility:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to evaluate gas eligibility",
        eligibility: {
          destinationChain: "unknown",
          isSponsoredEligible: false,
          isManualClaimRequired: true,
          manualClaimReason: "Unable to verify network fee",
        },
      },
      { status: 500 }
    );
  }
}

