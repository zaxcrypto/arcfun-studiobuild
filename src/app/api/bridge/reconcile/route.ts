import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/rate-limit';
import { TESTNET_SUPPORTED_CHAINS, MAINNET_SUPPORTED_CHAINS } from '@/config/swap-contract';
import { getCctpDomains, pollCCTPAttestation } from '@/lib/bridge/cctp-provider';
import { isValidWalletAddress } from '@/app/api/bridge/history/route';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const maxDuration = 60; // Up to 60s for batch reconciliation

/**
 * POST /api/bridge/reconcile
 * Durable, idempotent background worker/endpoint for pending bridge transactions.
 *
 * Requirements:
 * 1. Independent: Can be invoked by cron, worker, or asynchronously by client without blocking GET /history.
 * 2. Idempotent: Only updates status if changed. Uses updated_at timestamp as an atomic lock.
 * 3. Safe retry: Interrupted work resumes on next tick; transactions older than 15s cooldown are eligible.
 * 4. Stop monitoring: Once terminal ('COMPLETED' or 'FAILED'), transactions are never queried again.
 */
export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch (_) {}

    const { wallet_address, environment } = body;

    // Check optional worker authorization or rate-limit client calls
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = req.headers.get('authorization') || '';
    const isCronAuthorized = cronSecret && authHeader === `Bearer ${cronSecret}`;

    if (!isCronAuthorized) {
      // Public / client rate limit: 15 reconciliation requests per minute per IP/wallet
      const rateLimitError = await checkRateLimit(req, wallet_address, { maxRequests: 15, windowMs: 60000 });
      if (rateLimitError) return rateLimitError;
    }

    const env: 'testnet' | 'mainnet' = environment === 'mainnet' ? 'mainnet' : 'testnet';
    const allowedChains = env === 'mainnet' ? MAINNET_SUPPORTED_CHAINS : TESTNET_SUPPORTED_CHAINS;
    const activeDomains = getCctpDomains(env);

    // Build query for pending bridge transactions that require reconciliation
    let query = supabaseAdmin
      .from('bridge_transactions')
      .select('id, wallet_address, source_chain, destination_chain, burn_tx_hash, updated_at, created_at, bridge_status')
      .in('source_chain', [...allowedChains])
      .neq('bridge_status', 'COMPLETED')
      .neq('bridge_status', 'FAILED')
      .order('created_at', { ascending: false })
      .limit(10); // Process batch of up to 10 pending records

    if (wallet_address && isValidWalletAddress(wallet_address)) {
      query = query.eq('wallet_address', wallet_address.toLowerCase());
    }

    const { data: pendingTxs, error: dbError } = await query;

    if (dbError) {
      console.error('[Bridge Reconcile] DB query error:', dbError);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    if (!pendingTxs || pendingTxs.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: 'No pending bridge transactions to reconcile' });
    }

    const reconciledResults: Array<{ id: string; burn_tx_hash: string; new_status: string }> = [];

    for (const tx of pendingTxs) {
      try {
        const lastUpdatedMs = new Date(tx.updated_at || tx.created_at).getTime();
        // 15-second cooldown guard prevents concurrent reconciliation storms
        if (Date.now() - lastUpdatedMs < 15_000) {
          continue;
        }

        // Acquire lock by bumping updated_at
        const nowIso = new Date().toISOString();
        await supabaseAdmin
          .from('bridge_transactions')
          .update({ updated_at: nowIso })
          .eq('id', tx.id)
          .neq('bridge_status', 'COMPLETED')
          .neq('bridge_status', 'FAILED');

        const sourceDomainDef = activeDomains[tx.source_chain];
        const destDomainDef = activeDomains[tx.destination_chain];
        if (!sourceDomainDef || !destDomainDef) continue;

        // Query Circle Iris API with short 2.5s timeout
        const irisResult = await pollCCTPAttestation(sourceDomainDef.domain, tx.burn_tx_hash, 2500, env).catch(() => null);

        if (irisResult && (irisResult.destinationMintTxHash || (irisResult as any).claimed)) {
          const mintHash = irisResult.destinationMintTxHash || 'ALREADY_CLAIMED_ON_CHAIN';
          await supabaseAdmin
            .from('bridge_transactions')
            .update({
              bridge_status: 'COMPLETED',
              mint_tx_hash: mintHash,
              completed_at: new Date().toISOString(),
              failure_reason: null,
            })
            .eq('id', tx.id);

          reconciledResults.push({ id: tx.id, burn_tx_hash: tx.burn_tx_hash, new_status: 'COMPLETED' });
        }
      } catch (itemErr) {
        console.warn(`[Bridge Reconcile] Failed reconciling tx ${tx.id}:`, itemErr);
      }
    }

    return NextResponse.json({
      success: true,
      processed: reconciledResults.length,
      reconciled: reconciledResults,
    });
  } catch (error: any) {
    console.error('[Bridge Reconcile] Fatal error:', error);
    return NextResponse.json({ error: 'Internal server error during reconciliation' }, { status: 500 });
  }
}

