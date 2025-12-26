import { NextResponse } from 'next/server';
import { supabase, getNetwork, type DbSession, type DbSessionBalance } from '@/lib/db';
import { getAuthenticatedPayer } from '@/lib/auth/payer';
import { getEffectiveStatus } from '@/lib/session-filters';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkManagementRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

// GET /api/payer/sessions/reclaimable - List sessions that can be reclaimed
// Returns active sessions with available balance > 0
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

    // Query active sessions by payer wallet (both active and those with status='active' that may have expired)
    // We check effective status in-memory to include expired sessions that still have reclaimable funds
    const { data: sessions, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('payer', payer.wallet)
      .in('status', ['active']) // Only DB-active sessions (not already voided/captured)
      .order('created_at', { ascending: false })
      .returns<DbSession[]>();

    if (error) {
      log.error('Failed to list reclaimable sessions', new Error(error.message));
      return NextResponse.json(
        { error: 'Failed to list sessions' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    if (!sessions || sessions.length === 0) {
      return NextResponse.json(
        {
          sessions: [],
          totalAvailable: '0',
          count: 0,
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

    // Get network names
    const networkIds = [...new Set(sessions.map((s) => s.network_id))];
    const networks = await Promise.all(networkIds.map((id) => getNetwork(id)));
    const networkMap = new Map(networks.filter(Boolean).map((n) => [n!.id, n!.name]));

    // Filter to sessions with available balance (both active AND expired)
    // Expired sessions can still be reclaimed via void() - just can't capture pending anymore
    const reclaimableSessions = sessions
      .map((s) => {
        const effectiveStatus = getEffectiveStatus(s);
        const balance = balanceMap.get(s.id);
        // For both active and expired sessions, check available balance
        const available = BigInt(balance?.available_amount || '0');

        return {
          session: s,
          balance,
          available,
          effectiveStatus,
          networkName: networkMap.get(s.network_id) || s.network_id,
        };
      })
      .filter((item) => item.available > 0n);

    // Calculate totals
    const totalAvailable = reclaimableSessions.reduce((sum, item) => sum + item.available, 0n);

    log.debug('Reclaimable sessions listed', {
      wallet: payer.wallet,
      count: reclaimableSessions.length,
      totalAvailable: totalAvailable.toString(),
    });

    return NextResponse.json(
      {
        sessions: reclaimableSessions.map((item) => ({
          id: item.session.id,
          networkId: item.session.network_id,
          networkName: item.networkName,
          receiver: item.session.receiver,
          balance: {
            authorized: item.balance?.authorized_amount || item.session.authorized_amount,
            captured: item.balance?.captured_amount || '0',
            pending: item.balance?.pending_amount || '0',
            available: item.available.toString(),
          },
          authorizationExpiry: Math.floor(
            new Date(item.session.authorization_expiry).getTime() / 1000
          ),
          refundExpiry: Math.floor(new Date(item.session.refund_expiry).getTime() / 1000),
        })),
        totalAvailable: totalAvailable.toString(),
        count: reclaimableSessions.length,
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error(
      'List reclaimable sessions error',
      err instanceof Error ? err : new Error(String(err))
    );
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
