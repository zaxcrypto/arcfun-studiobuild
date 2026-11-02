import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { MAINNET_SUPPORTED_CHAINS, TESTNET_SUPPORTED_CHAINS } from '@/config/swap-contract';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "10", 10) || 10, 1), 50);
    const offset = Math.max(parseInt(searchParams.get("offset") || "0", 10) || 0, 0);
    const network = searchParams.get("network") || searchParams.get("mode");

    const buildQuery = (useNetworkColumn: boolean) => {
      let q = supabaseAdmin
        .from("bridge_transactions")
        .select("id, wallet_address, source_chain, destination_chain, token_symbol, amount, burn_tx_hash, mint_tx_hash, bridge_status, created_at, updated_at", { count: 'exact' });

      if (network === "mainnet" || network === "testnet") {
        if (useNetworkColumn) {
          q = q.eq("network", network);
        } else {
          const allowedChains = network === "mainnet" ? MAINNET_SUPPORTED_CHAINS : TESTNET_SUPPORTED_CHAINS;
          q = q.in("source_chain", [...allowedChains]);
        }
      }

      return q
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);
    };

    // First attempt: try network column (if migration 033 has been applied)
    let { data: transactions, count, error } = await buildQuery(true);

    // Fallback: if network column does not exist yet (code 42703), filter by source_chain
    if (error && (error.code === '42703' || error.message?.includes('network'))) {
      const fallbackResult = await buildQuery(false);
      transactions = fallbackResult.data;
      count = fallbackResult.count;
      error = fallbackResult.error;
    }

    if (error) {
      console.error("[LiveFeed API] Supabase error:", error);
      return NextResponse.json({ error: "Failed to fetch live feed" }, { status: 500 });
    }

    const totalCount = count || 0;

    return NextResponse.json({
      success: true,
      transactions: transactions || [],
      totalCount,
      limit,
      offset,
      hasMore: offset + limit < totalCount
    }, {
      headers: {
        'Cache-Control': 'public, s-maxage=3, stale-while-revalidate=5'
      }
    });
  } catch (err: any) {
    console.error("[LiveFeed API] Unexpected error:", err);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

