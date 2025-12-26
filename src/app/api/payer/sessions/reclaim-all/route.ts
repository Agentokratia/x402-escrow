import { NextResponse } from 'next/server';
import { supabase, getNetwork, type DbSession, type DbSessionBalance } from '@/lib/db';
import { getAuthenticatedPayer } from '@/lib/auth/payer';
import { getEffectiveStatus } from '@/lib/session-filters';
import { batchCaptureAndVoid, sessionToPaymentInfo } from '@/lib/escrow';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkReclaimRateLimit, rateLimitHeaders } from '@/lib/rate-limit';
import { withTimeout } from '@/lib/helpers';
import { RECLAIM_TIMEOUT_MS } from '@/lib/constants';

// Extended timeout for batch operations (per network batch)
const BATCH_TIMEOUT_MS = RECLAIM_TIMEOUT_MS * 2; // 180 seconds

// POST /api/payer/sessions/reclaim-all - Reclaim all reclaimable sessions in a single transaction
// Uses Multicall3 to batch capture pending amounts and void sessions
export async function POST(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);

  try {
    const payer = await getAuthenticatedPayer(request);

    if (!payer) {
      return NextResponse.json({ error: 'Unauthorized - JWT required' }, { status: 401 });
    }

    // Rate limit check (by wallet - reclaim is expensive on-chain operation)
    const rateLimit = checkReclaimRateLimit(payer.wallet);
    if (!rateLimit.allowed) {
      log.warn('Reclaim-all rate limit exceeded', { wallet: payer.wallet });
      return NextResponse.json(
        { error: 'Rate limit exceeded - too many reclaim requests' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Query active sessions by payer wallet
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('payer', payer.wallet)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .returns<DbSession[]>();

    if (error) {
      log.error('Failed to list sessions for reclaim-all', new Error(error.message));
      return NextResponse.json(
        { error: 'Failed to list sessions' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json(
        {
          success: true,
          message: 'No sessions to reclaim',
          reclaimedCount: 0,
          totalReclaimed: '0',
          totalCaptured: '0',
        },
        { headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Get session balances
    const sessionIds = sessions.map((s) => s.id);
    const { data: balances } = await supabase
      .from('session_balances')
      .select('*')
      .in('session_id', sessionIds)
      .returns<DbSessionBalance[]>();

    const balanceMap = new Map((balances || []).map((b) => [b.session_id, b]));

    // Filter to sessions with available balance (both active AND expired)
    // For expired sessions: available balance is reclaimable, but pending can't be captured anymore
    const now = Math.floor(Date.now() / 1000);
    const reclaimableSessions = sessions
      .map((s) => {
        const effectiveStatus = getEffectiveStatus(s);
        const balance = balanceMap.get(s.id);
        const available = BigInt(balance?.available_amount || '0');

        // Check if authorization has expired
        const authExpiry = Math.floor(new Date(s.authorization_expiry).getTime() / 1000);
        const authExpired = authExpiry < now;

        // For expired sessions, pending can't be captured (authorization expired)
        const pending = authExpired ? 0n : BigInt(balance?.pending_amount || '0');

        return {
          session: s,
          available,
          pending,
          effectiveStatus,
          authExpired,
        };
      })
      .filter((item) => item.available > 0n);

    if (reclaimableSessions.length === 0) {
      return NextResponse.json(
        {
          success: true,
          message: 'No sessions to reclaim',
          reclaimedCount: 0,
          totalReclaimed: '0',
          totalCaptured: '0',
        },
        { headers: rateLimitHeaders(rateLimit) }
      );
    }

    log.info('Starting reclaim-all operation', {
      wallet: payer.wallet,
      sessionCount: reclaimableSessions.length,
    });

    // Group by network for batch processing
    const byNetwork = new Map<string, typeof reclaimableSessions>();
    for (const item of reclaimableSessions) {
      const networkId = item.session.network_id;
      if (!byNetwork.has(networkId)) {
        byNetwork.set(networkId, []);
      }
      byNetwork.get(networkId)!.push(item);
    }

    // Track results for atomic DB update
    interface BatchResult {
      networkId: string;
      sessionIds: string[];
      txHash: string | null;
      reclaimed: bigint;
      captured: bigint;
    }
    const successfulBatches: BatchResult[] = [];
    const errors: string[] = [];

    // Process each network's sessions with Multicall3 (with timeout)
    for (const [networkId, networkSessions] of byNetwork) {
      const network = await getNetwork(networkId);
      if (!network) {
        log.warn(`Network ${networkId} not found, skipping`);
        errors.push(`Network ${networkId} not found`);
        continue;
      }

      // Build items for batch capture+void
      const items = networkSessions.map((item) => ({
        paymentInfo: sessionToPaymentInfo(item.session),
        captureAmount: item.pending, // Capture pending amount (owed to receiver)
      }));

      try {
        // Execute batch via Multicall3 with timeout
        const result = await withTimeout(
          batchCaptureAndVoid(networkId, items),
          BATCH_TIMEOUT_MS,
          `Batch reclaim on ${networkId}`
        );

        if (!result.success) {
          log.error(
            `Batch reclaim failed for network ${networkId}`,
            new Error(result.error || 'Unknown')
          );
          errors.push(`Network ${networkId}: ${result.error}`);
          continue;
        }

        // Track successful batch
        let batchReclaimed = 0n;
        let batchCaptured = 0n;
        const batchSessionIds: string[] = [];

        for (const item of networkSessions) {
          batchReclaimed += item.available;
          batchCaptured += item.pending;
          batchSessionIds.push(item.session.id);
        }

        successfulBatches.push({
          networkId,
          sessionIds: batchSessionIds,
          txHash: result.txHash || null,
          reclaimed: batchReclaimed,
          captured: batchCaptured,
        });

        log.debug(`Batch reclaim completed for network ${networkId}`, {
          sessionCount: networkSessions.length,
          txHash: result.txHash,
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          log.error(`Batch reclaim timed out for network ${networkId}`, err);
          errors.push(`Network ${networkId}: Operation timed out`);
        } else {
          log.error(
            `Batch reclaim error for network ${networkId}`,
            err instanceof Error ? err : new Error(String(err))
          );
          errors.push(
            `Network ${networkId}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }
      }
    }

    // Only update DB if we had successful on-chain operations
    // Use Promise.all for parallel updates (atomic per session via RPC)
    if (successfulBatches.length > 0) {
      const dbUpdatePromises = successfulBatches.flatMap((batch) =>
        batch.sessionIds.map((sessionId) =>
          supabase.rpc('void_session', {
            p_session_id: sessionId,
            p_capture_tx_hash: batch.txHash,
            p_void_tx_hash: batch.txHash,
          })
        )
      );

      const dbResults = await Promise.all(dbUpdatePromises);

      // Check for DB update failures (log but don't fail the response)
      const failedDbUpdates = dbResults.filter((r) => r.error);
      if (failedDbUpdates.length > 0) {
        log.error(
          'Some DB updates failed after successful on-chain operations',
          new Error(`${failedDbUpdates.length} updates failed`)
        );
      }
    }

    // Calculate totals
    const totalReclaimed = successfulBatches.reduce((sum, b) => sum + b.reclaimed, 0n);
    const totalCaptured = successfulBatches.reduce((sum, b) => sum + b.captured, 0n);
    const totalCount = successfulBatches.reduce((sum, b) => sum + b.sessionIds.length, 0);
    const txHashes = successfulBatches.map((b) => b.txHash).filter((h): h is string => h !== null);

    log.info('Reclaim-all completed', {
      wallet: payer.wallet,
      reclaimedCount: totalCount,
      totalReclaimed: totalReclaimed.toString(),
      errorsCount: errors.length,
    });

    const response: Record<string, unknown> = {
      success: errors.length === 0,
      message: `Reclaimed ${totalCount} session${totalCount !== 1 ? 's' : ''}${errors.length > 0 ? ` (${errors.length} errors)` : ''}`,
      reclaimedCount: totalCount,
      totalReclaimed: totalReclaimed.toString(),
      totalCaptured: totalCaptured.toString(),
      txHashes,
    };

    if (errors.length > 0) {
      response.errors = errors;
    }

    return NextResponse.json(response, { headers: rateLimitHeaders(rateLimit) });
  } catch (err) {
    log.error('Reclaim-all error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
