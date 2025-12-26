import { NextResponse } from 'next/server';
import { supabase, getSessionBalance, type DbSession } from '@/lib/db';
import { getAuthenticatedPayer } from '@/lib/auth/payer';
import { capture, voidSession, sessionToPaymentInfo } from '@/lib/escrow';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkReclaimRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { withTimeout } from '@/lib/helpers';
import { RECLAIM_TIMEOUT_MS } from '@/lib/constants';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// POST /api/payer/sessions/[id]/reclaim - Reclaim remaining funds from session
// This captures any pending amount (owed to receiver) and voids the remaining authorization
export async function POST(request: Request, { params }: RouteParams) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);

  try {
    const { id: sessionId } = await params;

    const payer = await getAuthenticatedPayer(request);

    if (!payer) {
      return NextResponse.json({ error: 'Unauthorized - JWT required' }, { status: 401 });
    }

    // Rate limit check (by wallet - reclaim is expensive on-chain operation)
    const rateLimit = checkReclaimRateLimit(payer.wallet);
    if (!rateLimit.allowed) {
      log.warn('Reclaim rate limit exceeded', { wallet: payer.wallet });
      return NextResponse.json(
        { error: 'Rate limit exceeded - too many reclaim requests' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Fetch full session data
    const { data: session } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single<DbSession>();

    if (!session) {
      log.debug('Session not found for reclaim', { sessionId });
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Verify session belongs to this payer
    if (session.payer !== payer.wallet) {
      log.warn('Session reclaim access denied', { sessionId, wallet: payer.wallet });
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Check session is not already voided
    if (session.status === 'voided') {
      return NextResponse.json(
        { error: 'Session already voided' },
        { status: 400, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Get balance from view (source of truth)
    const balance = await getSessionBalance(sessionId);
    if (!balance) {
      log.error('Failed to get session balance', new Error('Balance view returned null'));
      return NextResponse.json(
        { error: 'Failed to get session balance' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Reconstruct PaymentInfo for on-chain calls
    const paymentInfo = sessionToPaymentInfo(session);
    const pendingAmount = BigInt(balance.pending_amount);
    let captureTxHash: string | null = null;
    let voidTxHash: string | null = null;

    // Check if authorization has expired
    const now = Math.floor(Date.now() / 1000);
    const authExpired = paymentInfo.authorizationExpiry < now;

    log.info('Starting reclaim operation', {
      sessionId,
      pendingAmount: pendingAmount.toString(),
      authExpired,
    });

    // Wrap on-chain operations with timeout
    try {
      // If there's pending amount AND authorization hasn't expired, capture it first
      // (After auth expiry, capture is not possible - pending amount is forfeited)
      if (pendingAmount > BigInt(0) && !authExpired) {
        const captureResult = await withTimeout(
          capture(session.network_id, paymentInfo, pendingAmount),
          RECLAIM_TIMEOUT_MS,
          'Capture pending amount'
        );
        if (!captureResult.success) {
          log.error(
            'Failed to capture pending amount',
            new Error(captureResult.error || 'Unknown')
          );
          return NextResponse.json(
            { error: `Failed to capture pending amount: ${captureResult.error}` },
            { status: 500, headers: rateLimitHeaders(rateLimit) }
          );
        }
        captureTxHash = captureResult.txHash || null;
        log.debug('Pending amount captured', { txHash: captureTxHash });
      }

      // Void the remaining authorization (returns funds to payer)
      const voidResult = await withTimeout(
        voidSession(session.network_id, paymentInfo),
        RECLAIM_TIMEOUT_MS,
        'Void session'
      );
      if (!voidResult.success) {
        log.error('Failed to void session', new Error(voidResult.error || 'Unknown'));
        return NextResponse.json(
          { error: `Failed to void session: ${voidResult.error}` },
          { status: 500, headers: rateLimitHeaders(rateLimit) }
        );
      }
      voidTxHash = voidResult.txHash || null;
      log.debug('Session voided on-chain', { txHash: voidTxHash });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        log.error('Reclaim operation timed out', err);
        return NextResponse.json(
          { error: 'Operation timed out - please try again' },
          { status: 504, headers: rateLimitHeaders(rateLimit) }
        );
      }
      throw err;
    }

    // Use atomic DB function to update session
    const { data: result, error } = await supabase.rpc('void_session', {
      p_session_id: sessionId,
      p_capture_tx_hash: captureTxHash,
      p_void_tx_hash: voidTxHash,
    });

    if (error) {
      log.error('Void RPC error', new Error(error.message));
      return NextResponse.json(
        { error: 'Failed to update session' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const voidResultData = result[0];

    if (!voidResultData.success) {
      return NextResponse.json(
        { error: voidResultData.error_message },
        { status: 400, headers: rateLimitHeaders(rateLimit) }
      );
    }

    log.info('Reclaim completed', {
      sessionId,
      reclaimedAmount: voidResultData.voided_amount.toString(),
      capturedAmount: voidResultData.pending_captured.toString(),
    });

    return NextResponse.json(
      {
        success: true,
        reclaimedAmount: voidResultData.voided_amount.toString(),
        capturedAmount: voidResultData.pending_captured.toString(),
        voidTxHash: voidTxHash || undefined,
        captureTxHash: captureTxHash || undefined,
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('Payer reclaim error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
