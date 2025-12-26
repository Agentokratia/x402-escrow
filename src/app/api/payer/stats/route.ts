import { NextResponse } from 'next/server';
import { supabase, type DbSessionBalance } from '@/lib/db';
import { getAuthenticatedPayer } from '@/lib/auth/payer';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkManagementRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

// GET /api/payer/stats - Get aggregate statistics for payer
export async function GET(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);

  try {
    const payer = await getAuthenticatedPayer(request);

    if (!payer) {
      return NextResponse.json({ error: 'Unauthorized - JWT required' }, { status: 401 });
    }

    // Rate limit check (by user ID from JWT)
    const rateLimit = checkManagementRateLimit(payer.userId);
    if (!rateLimit.allowed) {
      log.warn('Management rate limit exceeded', { userId: payer.userId });
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Query aggregate stats for payer (uses session_balances view)
    const { data, error } = await supabase.rpc('get_payer_stats', {
      p_payer: payer.wallet,
    });

    if (error) {
      log.warn('RPC get_payer_stats failed, using fallback', { error: error.message });

      // Fallback to manual aggregation using session_balances view
      const { data: sessions, error: sessionError } = await supabase
        .from('sessions')
        .select('id, authorized_amount, status')
        .eq('payer', payer.wallet);

      if (sessionError) {
        log.error('Failed to get payer stats', new Error(sessionError.message));
        return NextResponse.json(
          { error: 'Failed to get stats' },
          { status: 500, headers: rateLimitHeaders(rateLimit) }
        );
      }

      // Get balances from session_balances view
      const sessionIds = sessions?.map((s) => s.id) || [];
      const { data: balances } =
        sessionIds.length > 0
          ? await supabase
              .from('session_balances')
              .select('*')
              .in('session_id', sessionIds)
              .returns<DbSessionBalance[]>()
          : { data: [] };

      const balanceMap = new Map((balances || []).map((b) => [b.session_id, b]));

      // Manual aggregation
      let totalAuthorized = BigInt(0);
      let totalCaptured = BigInt(0);
      let totalPending = BigInt(0);
      let totalAvailable = BigInt(0);
      let activeSessions = 0;
      let totalSessions = 0;

      for (const s of sessions || []) {
        totalSessions++;
        if (s.status === 'active') activeSessions++;
        totalAuthorized += BigInt(s.authorized_amount);
        const balance = balanceMap.get(s.id);
        if (balance) {
          totalCaptured += BigInt(balance.captured_amount);
          totalPending += BigInt(balance.pending_amount);
          // Only count available for non-voided sessions
          if (s.status !== 'voided') {
            totalAvailable += BigInt(balance.available_amount || '0');
          }
        }
      }

      log.debug('Payer stats computed (fallback)', { wallet: payer.wallet, totalSessions });
      return NextResponse.json(
        {
          totalAuthorized: totalAuthorized.toString(),
          totalCaptured: totalCaptured.toString(),
          totalPending: totalPending.toString(),
          totalAvailable: totalAvailable > 0 ? totalAvailable.toString() : '0',
          activeSessions,
          totalSessions,
        },
        { headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Use RPC result if available
    const stats = data[0] || {
      total_authorized: '0',
      total_captured: '0',
      total_pending: '0',
      total_available: '0',
      active_sessions: 0,
      total_sessions: 0,
    };

    log.debug('Payer stats fetched', { wallet: payer.wallet, totalSessions: stats.total_sessions });
    return NextResponse.json(
      {
        totalAuthorized: stats.total_authorized,
        totalCaptured: stats.total_captured,
        totalPending: stats.total_pending,
        totalAvailable: stats.total_available,
        activeSessions: stats.active_sessions,
        totalSessions: stats.total_sessions,
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('Get payer stats error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
