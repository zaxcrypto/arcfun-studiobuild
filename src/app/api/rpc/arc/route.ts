import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ARC_MAINNET_RPCS = [
  process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL,
  process.env.ARC_MAINNET_RPC_URL,
  "https://arc-mainnet.g.alchemy.com/v2/Vt9_fvDipTI7hEZdMc950",
  "https://rpc.mainnet.arc.io",
  "https://mainnet.arc.network"
].filter(Boolean) as string[];

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    let lastError: any = null;

    for (const rpcUrl of ARC_MAINNET_RPCS) {
      try {
        const response = await fetch(rpcUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          cache: "no-store"
        });

        if (response.ok) {
          const data = await response.json();
          return NextResponse.json(data);
        }
      } catch (err) {
        lastError = err;
        console.warn(`[Arc RPC Proxy] Fallback failed for ${rpcUrl}:`, err);
      }
    }

    return NextResponse.json(
      { jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32603, message: lastError?.message || "Internal RPC proxy error" } },
      { status: 502 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error / Invalid JSON" } },
      { status: 400 }
    );
  }
}

