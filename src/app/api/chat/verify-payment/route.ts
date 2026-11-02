import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { circleClient } from '@/lib/circle/wallet-service';
import { createPublicClient, http, decodeEventLog, parseUnits } from 'viem';
import { checkRateLimit } from '@/lib/rate-limit';
import { ERC20_ABI } from '@/config/contracts';
import { withEvmFailover } from '@/lib/evm-rpc';

/**
 * Strict Specification for Chain, Token Contract, and Decimals.
 * Enforces that only official, whitelisted tokens can satisfy payments.
 */
interface TokenNetworkSpec {
  chainName: string;
  chainId: number;
  primaryRpc: string;
  officialTokenAddress: string | null; // null for native transfers
  decimals: number;
  isNative: boolean;
}

function resolveTokenNetworkSpec(token: string): TokenNetworkSpec {
  const t = (token || '').toUpperCase().trim();

  // 1. Injective EVM Testnet (USDC-1439)
  if (t.includes('1439') || t.includes('INJECTIVE')) {
    return {
      chainName: 'Injective EVM Testnet',
      chainId: 1439,
      primaryRpc: process.env.NEXT_PUBLIC_INJECTIVE_TESTNET_RPC_URL || 'https://k8s.testnet.json-rpc.injective.network/',
      officialTokenAddress: '0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d'.toLowerCase(),
      decimals: 6,
      isNative: false,
    };
  }

  // 2. Base Mainnet (USDC-8453)
  if (t.includes('8453') || t.includes('BASE')) {
    return {
      chainName: 'Base Mainnet',
      chainId: 8453,
      primaryRpc: process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL || 'https://mainnet.base.org',
      officialTokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'.toLowerCase(),
      decimals: 6,
      isNative: false,
    };
  }

  // 3. Arc Mainnet (USDC-MAINNET / 5042)
  if (t.includes('MAINNET') || t.includes('5042')) {
    return {
      chainName: 'Arc Mainnet',
      chainId: 5042,
      primaryRpc: process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL || 'https://arc-mainnet.g.alchemy.com/v2/Vt9_fvDipTI7hEZdMc950',
      officialTokenAddress: '0x3600000000000000000000000000000000000000'.toLowerCase(),
      decimals: 6,
      isNative: false,
    };
  }

  // 4. EURC on Arc Testnet
  if (t.includes('EURC')) {
    return {
      chainName: 'Arc Testnet',
      chainId: 5042002,
      primaryRpc: process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || 'https://5042002.rpc.thirdweb.com',
      officialTokenAddress: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a'.toLowerCase(),
      decimals: 6,
      isNative: false,
    };
  }

  // 5. Robinhood Mainnet (USDG-4663 / USDe-4663)
  if (t.includes('4663') || t.includes('ROBINHOOD')) {
    const isUSDe = t.includes('USDE');
    return {
      chainName: 'Robinhood Mainnet',
      chainId: 4663,
      primaryRpc: process.env.NEXT_PUBLIC_ROBINHOOD_MAINNET_RPC_URL || '',
      officialTokenAddress: isUSDe
        ? '0x5d3a1ff2b6bab83b63cd9ad0787074081a52ef34'.toLowerCase()
        : '0x5fc5360d0400a0fd4f2af552add042d716f1d168'.toLowerCase(),
      decimals: isUSDe ? 18 : 6,
      isNative: false,
    };
  }

  // 6. Native ETH / ARC
  if (t === 'ETH' || t === 'ARC' || t === 'NATIVE') {
    return {
      chainName: 'Arc Testnet',
      chainId: 5042002,
      primaryRpc: process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || 'https://5042002.rpc.thirdweb.com',
      officialTokenAddress: null,
      decimals: 18,
      isNative: true,
    };
  }

  // 7. Default: USDC on Arc Testnet
  return {
    chainName: 'Arc Testnet',
    chainId: 5042002,
    primaryRpc: process.env.NEXT_PUBLIC_ARC_TESTNET_RPC_URL || 'https://5042002.rpc.thirdweb.com',
    officialTokenAddress: '0x3600000000000000000000000000000000000000'.toLowerCase(),
    decimals: 6,
    isNative: false,
  };
}

export async function POST(req: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // 1. Optional session verification (supports both Web3 wallet callers & Supabase sessions)
    const authHeader = req.headers.get("authorization");
    let authenticatedUserId: string | null = null;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      try {
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (user) {
          authenticatedUserId = user.id;
        }
      } catch {
        // Fallback for custom Web3 JWTs or stateless callers
      }
    }

    // Rate limit by authenticated user ID or caller IP
    const rateLimitError = await checkRateLimit(req, authenticatedUserId || undefined, { maxRequests: 60, windowMs: 60000 });
    if (rateLimitError) return rateLimitError;

    const body = await req.json();
    const { paymentId, txHash } = body;

    if (!paymentId || !txHash) {
      return NextResponse.json({ error: 'Missing paymentId or txHash' }, { status: 400 });
    }

    const normalizedTxHash = String(txHash).trim();

    // 2. Fetch payment record from database
    const { data: payment, error: paymentErr } = await supabaseAdmin
      .from('payments')
      .select('*')
      .eq('id', paymentId)
      .maybeSingle();

    if (paymentErr || !payment) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    const senderExpected = (payment.sender || '').toLowerCase().trim();
    const receiverExpected = (payment.receiver || '').toLowerCase().trim();

    // If caller has an authenticated Supabase user profile, verify ownership
    if (authenticatedUserId) {
      const { data: userWallets } = await supabaseAdmin
        .from('arc_wallets')
        .select('address')
        .eq('user_id', authenticatedUserId);

      const userAddresses = (userWallets || []).map((w: any) => w.address?.toLowerCase()).filter(Boolean);
      if (userAddresses.length > 0) {
        const isOwner = userAddresses.includes(senderExpected) || userAddresses.includes(receiverExpected);
        if (!isOwner) {
          return NextResponse.json({ error: 'Forbidden: You do not own this payment record' }, { status: 403 });
        }
      }
    }

    // 3. Idempotent Retry: Already confirmed or failed
    if (payment.status === 'confirmed' || payment.status === 'failed') {
      return NextResponse.json({ 
        success: true, 
        status: payment.status, 
        txHash: payment.tx_hash || normalizedTxHash 
      });
    }

    // 4. P0-SEC-02: Pre-check for Transaction Hash Replay across other confirmed payments
    const { data: existingConfirmedPayment } = await supabaseAdmin
      .from('payments')
      .select('id, tx_hash, status')
      .eq('tx_hash', normalizedTxHash)
      .eq('status', 'confirmed')
      .neq('id', payment.id)
      .maybeSingle();

    if (existingConfirmedPayment) {
      console.warn(`[VerifyPayment] Replay attack prevented: txHash ${normalizedTxHash} already confirmed on payment ${existingConfirmedPayment.id}`);
      return NextResponse.json({
        error: 'Transaction hash has already been consumed by another confirmed payment',
        code: 'TX_ALREADY_USED'
      }, { status: 409 });
    }

    let updatedStatus: 'confirmed' | 'failed' | 'pending' = 'pending';
    let confirmedTxHash = payment.tx_hash || normalizedTxHash;
    let verificationFailureReason: string | null = null;

    // ── Case A: Circle DCW Transaction (UUID - 36 chars) ──────────────────────────
    if (normalizedTxHash.length === 36 && !normalizedTxHash.startsWith('0x')) {
      // 1. Check payment_ledger first
      const { data: ledgerEntry } = await supabaseAdmin
        .from('payment_ledger')
        .select('status, blockchain_hash, to_wallet, from_wallet, amount')
        .eq('circle_tx_id', normalizedTxHash)
        .maybeSingle();

      if (ledgerEntry) {
        const ledgerDest = (ledgerEntry.to_wallet || '').toLowerCase().trim();
        if (receiverExpected && ledgerDest && ledgerDest !== receiverExpected) {
          console.warn(`[VerifyPayment] Ledger recipient mismatch: ${ledgerDest} vs expected ${receiverExpected}`);
          return NextResponse.json({ error: 'Recipient mismatch on ledger record' }, { status: 400 });
        }

        const ledgerAmount = Number(ledgerEntry.amount);
        const expectedAmount = Number(payment.amount);
        if (isNaN(ledgerAmount) || ledgerAmount < expectedAmount) {
          console.warn(`[VerifyPayment] Insufficient amount on ledger record: ${ledgerAmount} < ${expectedAmount}`);
          return NextResponse.json({ error: 'Insufficient payment amount on ledger record', code: 'INSUFFICIENT_AMOUNT' }, { status: 400 });
        }

        if (ledgerEntry.status === 'COMPLETE' || ledgerEntry.status === 'CONFIRMED') {
          updatedStatus = 'confirmed';
          if (ledgerEntry.blockchain_hash) confirmedTxHash = ledgerEntry.blockchain_hash;
        } else if (ledgerEntry.status === 'FAILED' || ledgerEntry.status === 'CANCELLED') {
          updatedStatus = 'failed';
        }
      }

      // 2. Query Circle API if still pending
      if (updatedStatus === 'pending') {
        try {
          const circleRes = await circleClient.getTransaction({ id: normalizedTxHash });
          const txData = circleRes.data?.transaction;
          if (txData) {
            const circleDest = (txData.destinationAddress || '').toLowerCase().trim();
            if (receiverExpected && circleDest && circleDest !== receiverExpected) {
              console.warn(`[VerifyPayment] Circle recipient mismatch: ${circleDest} vs expected ${receiverExpected}`);
              return NextResponse.json({ error: 'Recipient mismatch on Circle transaction' }, { status: 400 });
            }

            if (txData.amounts && txData.amounts.length > 0) {
              const circleAmount = Number(txData.amounts[0]);
              const expectedAmount = Number(payment.amount);
              if (isNaN(circleAmount) || circleAmount < expectedAmount) {
                console.warn(`[VerifyPayment] Insufficient amount on Circle tx: ${circleAmount} < ${expectedAmount}`);
                return NextResponse.json({ error: 'Insufficient payment amount on Circle transaction', code: 'INSUFFICIENT_AMOUNT' }, { status: 400 });
              }
            }

            if (txData.state === 'COMPLETE') {
              updatedStatus = 'confirmed';
              if (txData.txHash) confirmedTxHash = txData.txHash;
            } else if (txData.state === 'FAILED' || txData.state === 'CANCELLED') {
              updatedStatus = 'failed';
            }
          }
        } catch (circleErr: any) {
          console.warn("[VerifyPayment] Circle API check warning:", circleErr.message);
        }
      }
    } 
    // ── Case B: EVM On-Chain Transaction Hash (0x...) ─────────────────────────────
    else if (normalizedTxHash.startsWith('0x') && normalizedTxHash.length === 66) {
      const spec = resolveTokenNetworkSpec(payment.token);

      const rawAmount = Number(payment.amount);
      if (isNaN(rawAmount) || rawAmount <= 0) {
        return NextResponse.json({ error: 'Invalid payment record amount', code: 'INVALID_PAYMENT_AMOUNT' }, { status: 400 });
      }

      // Convert payment amount to smallest token integer unit (wei)
      let expectedUnits: bigint;
      try {
        expectedUnits = parseUnits(rawAmount.toFixed(spec.decimals), spec.decimals);
      } catch (err: any) {
        console.error("[VerifyPayment] Failed to compute token expectedUnits:", err);
        return NextResponse.json({ error: 'Amount precision conversion failed', code: 'PRECISION_ERROR' }, { status: 400 });
      }

      try {
        await withEvmFailover(
          spec.chainName,
          spec.primaryRpc,
          async (rpcUrl: string) => {
            const publicClient = createPublicClient({ transport: http(rpcUrl, { timeout: 8000 }) });
            const receipt = await publicClient.getTransactionReceipt({ hash: normalizedTxHash as `0x${string}` });

            if (!receipt) {
              verificationFailureReason = 'Transaction receipt not yet available on RPC';
              return;
            }

            // 1. Transaction Reverted
            if (receipt.status === 'reverted') {
              updatedStatus = 'failed';
              return;
            }

            // 2. Transaction Succeeded On-Chain
            if (receipt.status === 'success') {
              const tx = await publicClient.getTransaction({ hash: normalizedTxHash as `0x${string}` });
              let isVerified = false;

              // Check A: Native Transfer (Only if token specification is explicitly native)
              if (spec.isNative) {
                if (tx) {
                  const txFrom = (tx.from || '').toLowerCase().trim();
                  const txTo = (tx.to || '').toLowerCase().trim();
                  const txValue = BigInt(tx.value);

                  const senderMatches = !senderExpected || txFrom === senderExpected;
                  const recipientMatches = txTo === receiverExpected;
                  const amountMatches = txValue >= expectedUnits;

                  if (recipientMatches && senderMatches && amountMatches) {
                    isVerified = true;
                  } else {
                    verificationFailureReason = `Native transfer mismatch: sender=${senderMatches}, recipient=${recipientMatches}, amount=${amountMatches}`;
                  }
                }
              } 
              // Check B: ERC-20 Transfer Event (Strict Official Token Contract Matching)
              else if (spec.officialTokenAddress) {
                if (receipt.logs && receipt.logs.length > 0) {
                  for (const log of receipt.logs) {
                    // P0-SEC-01: STRICTLY reject dummy tokens / non-official contracts!
                    if (log.address.toLowerCase() !== spec.officialTokenAddress) {
                      continue;
                    }

                    try {
                      const decoded = decodeEventLog({
                        abi: ERC20_ABI,
                        data: log.data,
                        topics: log.topics
                      });

                      if (decoded.eventName === 'Transfer') {
                        const args: any = decoded.args;
                        const logFrom = (args.from || '').toLowerCase().trim();
                        const logTo = (args.to || '').toLowerCase().trim();
                        const logValue: bigint = BigInt(args.value);

                        const recipientMatches = logTo === receiverExpected;
                        const senderMatches = !senderExpected || 
                                              logFrom === senderExpected || 
                                              (tx && (tx.from || '').toLowerCase() === senderExpected);
                        
                        // P0-SEC-01: Explicit amount comparison:
                        // Business logic permits exact match or overpayment (args.value >= expectedUnits),
                        // and strictly rejects any insufficient payment (args.value < expectedUnits).
                        const amountSufficient = logValue >= expectedUnits;

                        if (recipientMatches && senderMatches && amountSufficient) {
                          isVerified = true;
                          break;
                        } else {
                          verificationFailureReason = `Transfer log evaluated: recipientMatches=${recipientMatches}, senderMatches=${senderMatches}, amountSufficient=${amountSufficient} (logValue: ${logValue}, expected: ${expectedUnits})`;
                        }
                      }
                    } catch {
                      // Log is not an ERC20 Transfer event from this contract; continue inspection
                    }
                  }
                } else {
                  verificationFailureReason = 'Transaction receipt contains no event logs';
                }
              }

              if (isVerified) {
                updatedStatus = 'confirmed';
                confirmedTxHash = normalizedTxHash;
              } else {
                console.warn(`[VerifyPayment] On-chain tx ${normalizedTxHash} found, but failed strict criteria: ${verificationFailureReason}`);
                updatedStatus = 'pending';
              }
            }
          },
          `Verify Payment ${paymentId}`
        );
      } catch (evmErr: any) {
        console.warn("[VerifyPayment] EVM receipt check note:", evmErr.message);
      }
    } else {
      return NextResponse.json({ error: 'Invalid transaction hash format' }, { status: 400 });
    }

    // ── 5. P0-SEC-02: Atomic CAS State Transition ─────────────────────────────────
    if (updatedStatus === 'confirmed') {
      // Secondary concurrency check immediately before CAS write
      const { data: secondCheck } = await supabaseAdmin
        .from('payments')
        .select('id')
        .eq('tx_hash', confirmedTxHash)
        .eq('status', 'confirmed')
        .neq('id', payment.id)
        .maybeSingle();

      if (secondCheck) {
        console.warn(`[VerifyPayment] Concurrent replay race detected: txHash ${confirmedTxHash} already confirmed on payment ${secondCheck.id}`);
        return NextResponse.json({
          error: 'Transaction hash has already been consumed by another confirmed payment',
          code: 'TX_ALREADY_USED'
        }, { status: 409 });
      }

      // Atomic Compare-And-Swap update: only update if current status in DB is 'pending'
      const { data: updatedPayment, error: updateErr } = await supabaseAdmin
        .from('payments')
        .update({
          status: 'confirmed',
          tx_hash: confirmedTxHash
        })
        .eq('id', payment.id)
        .eq('status', 'pending')
        .select()
        .maybeSingle();

      if (updateErr) {
        console.error("[VerifyPayment] Database CAS update error:", updateErr);
        return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
      }

      if (!updatedPayment) {
        // Status was no longer pending (already confirmed or modified by concurrent process)
        const { data: latestPayment } = await supabaseAdmin
          .from('payments')
          .select('status, tx_hash')
          .eq('id', payment.id)
          .single();

        return NextResponse.json({
          success: true,
          status: latestPayment?.status || 'confirmed',
          txHash: latestPayment?.tx_hash || confirmedTxHash
        });
      }
    } else if (updatedStatus === 'failed') {
      await supabaseAdmin
        .from('payments')
        .update({
          status: 'failed',
          tx_hash: confirmedTxHash
        })
        .eq('id', payment.id)
        .eq('status', 'pending');
    }

    return NextResponse.json({
      success: true,
      status: updatedStatus,
      txHash: confirmedTxHash,
      ...(updatedStatus === 'pending' && verificationFailureReason ? { reason: verificationFailureReason } : {})
    });

  } catch (error: any) {
    console.error("Payment verification route failed:", error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
