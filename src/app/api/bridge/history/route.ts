import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/rate-limit';
import { TESTNET_SUPPORTED_CHAINS, MAINNET_SUPPORTED_CHAINS } from '@/config/swap-contract';
import { guardMainnetApi } from '@/lib/network-mode-server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-service-key';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ── Server-enforced strict maximum page size ────────────────────────────────
export const MAX_PAGE_SIZE = 10;

// ── Regex for wallet address validation ─────────────────────────────────────
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export function isValidWalletAddress(addr: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  const trimmed = addr.trim();
  return EVM_ADDRESS_REGEX.test(trimmed) || SOLANA_ADDRESS_REGEX.test(trimmed) || STELLAR_ADDRESS_REGEX.test(trimmed);
}

// ── Keyset Cursor Encoding / Decoding ───────────────────────────────────────
// Encodes: { created_at: string (ISO), id: string }
export function encodeCursor(created_at: string, id: string): string {
  return Buffer.from(`${created_at}__${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { created_at: string; id: string } | null {
  try {
    if (!cursor || typeof cursor !== 'string' || cursor.length > 256) return null;
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('__');
    if (sep === -1) return null;
    const created_at = decoded.slice(0, sep);
    const id = decoded.slice(sep + 2);
    if (!created_at || isNaN(Date.parse(created_at))) return null;
    if (!id || id.length > 100) return null;
    return { created_at, id };
  } catch {
    return null;
  }
}

/**
 * GET /api/bridge/history
 * Strict read-only, fast, server-paginated transaction history for Arc.fun bridge.
 * Returns at most MAX_PAGE_SIZE (10) records per request.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rawWallet = searchParams.get('wallet');
    const envParam = (searchParams.get('environment') || 'testnet').toLowerCase();
    const env: 'mainnet' | 'testnet' = envParam === 'mainnet' ? 'mainnet' : 'testnet';
    const pendingOnly = searchParams.get('pending') === 'true';
    const rawStatus = (searchParams.get('status') || 'all').toLowerCase();
    const cursorParam = searchParams.get('cursor') || null;

    // 1. Guard Mainnet if requested
    const guardRefusal = guardMainnetApi(req);
    if (guardRefusal) return guardRefusal;

    // 2. Validate Wallet Address format
    if (!rawWallet) {
      return NextResponse.json({ error: 'Missing wallet parameter' }, { status: 400 });
    }
    const walletAddress = rawWallet.trim().toLowerCase();
    if (!isValidWalletAddress(walletAddress)) {
      return NextResponse.json({ error: 'Invalid wallet address format' }, { status: 400 });
    }

    // 3. Validate Status Filter
    const VALID_STATUSES = ['all', 'success', 'pending', 'failed'] as const;
    const statusFilter = VALID_STATUSES.includes(rawStatus as any) ? rawStatus : 'all';

    // 4. Validate Cursor format
    let decodedCursor: { created_at: string; id: string } | null = null;
    if (cursorParam) {
      decodedCursor = decodeCursor(cursorParam);
      if (!decodedCursor) {
        return NextResponse.json({ error: 'Invalid pagination cursor' }, { status: 400 });
      }
    }

    // 5. Rate Limiting: 60 req/min for History pagination
    const rateLimitError = await checkRateLimit(req, walletAddress, { maxRequests: 60, windowMs: 60000 });
    if (rateLimitError) return rateLimitError;

    // 6. Partition by Allowed Supported Chains
    const allowedChains = env === 'mainnet' ? MAINNET_SUPPORTED_CHAINS : TESTNET_SUPPORTED_CHAINS;

    // 7. Execute Strict Server-Side Paginated Query
    // Order: created_at DESC, id DESC
    // Limit: MAX_PAGE_SIZE + 1 (11 items) to detect hasMore with 0 over-fetch
    let query = supabaseAdmin
      .from('bridge_transactions')
      .select('id, wallet_address, source_chain, destination_chain, token_symbol, amount, burn_tx_hash, mint_tx_hash, bridge_status, created_at, updated_at, completed_at, failure_reason')
      .eq('wallet_address', walletAddress)
      .in('source_chain', [...allowedChains])
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(MAX_PAGE_SIZE + 1);

    // Apply Server-Side Status Filter
    if (pendingOnly || statusFilter === 'pending') {
      query = query.neq('bridge_status', 'COMPLETED').neq('bridge_status', 'FAILED');
    } else if (statusFilter === 'success') {
      query = query.eq('bridge_status', 'COMPLETED');
    } else if (statusFilter === 'failed') {
      query = query.eq('bridge_status', 'FAILED');
    }

    // Apply Keyset Cursor condition at database level: strictly older rows (or identical timestamp with smaller id)
    if (decodedCursor) {
      query = query.or(
        `created_at.lt.${decodedCursor.created_at},and(created_at.eq.${decodedCursor.created_at},id.lt.${decodedCursor.id})`
      );
    }

    const { data: rawData, error: dbError } = await query;

    if (dbError) {
      console.error('[Bridge History Query Error]:', dbError);
      return NextResponse.json({ error: 'Database query failed' }, { status: 500 });
    }

    const rows = rawData ?? [];

    // Strict pagination: exactly MAX_PAGE_SIZE (10) returned to client
    const hasMore = rows.length > MAX_PAGE_SIZE;
    const pageRows = rows.slice(0, MAX_PAGE_SIZE);

    let nextCursor: string | null = null;
    if (hasMore && pageRows.length === MAX_PAGE_SIZE) {
      const last = pageRows[pageRows.length - 1];
      nextCursor = encodeCursor(last.created_at, last.id);
    }

    return NextResponse.json({
      success: true,
      data: pageRows,
      nextCursor,
      hasMore,
      pageSize: pageRows.length,
    }, {
      headers: {
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      }
    });
  } catch (error: any) {
    console.error('[Bridge History GET Error]:', error?.message || error);
    return NextResponse.json({ error: 'Failed to retrieve transaction history' }, { status: 500 });
  }
}
