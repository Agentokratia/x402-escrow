import { NextResponse } from 'next/server';
import { supabase, type DbSessionBalance } from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkManagementRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

// GET /api/stats - Get dashboard stats for incoming payments (sessions created via user's API key)
export async function GET(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);

  try {
    const auth = await getAuthenticatedUser(request);

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Rate limit check (by user ID)
    const rateLimit = checkManagementRateLimit(auth.userId);
    if (!rateLimit.allowed) {
      log.warn('Management rate limit exceeded', { userId: auth.userId });
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Get API keys count for this user
    const { count: apiKeysCount } = await supabase
      .from('api_keys')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', auth.userId)
      .eq('status', 'active');

    // Get all sessions for this user with status counts (limit to prevent unbounded queries)
    const { data: userSessions } = await supabase
      .from('sessions')
      .select('id, status, payer, authorized_amount, created_at')
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .limit(1000); // Limit to prevent performance issues

    // Count sessions by status
    const statusCounts = {
      active: 0,
      captured: 0,
      voided: 0,
      expired: 0,
    };

    let totalCaptured = BigInt(0);
    let pendingAmount = BigInt(0);

    if (userSessions && userSessions.length > 0) {
      // Count statuses
      for (const s of userSessions) {
        const status = s.status as keyof typeof statusCounts;
        if (status in statusCounts) {
          statusCounts[status]++;
        }
      }

      // Get balances from session_balances view (source of truth)
      const sessionIds = userSessions.map((s) => s.id);
      const { data: balances } = await supabase
        .from('session_balances')
        .select('*')
        .in('session_id', sessionIds)
        .returns<DbSessionBalance[]>();

      if (balances) {
        for (const balance of balances) {
          totalCaptured += BigInt(balance.captured_amount || 0);
          pendingAmount += BigInt(balance.pending_amount || 0);
        }
      }
    }

    // Get recent sessions (last 5)
    const recentSessions = (userSessions || []).slice(0, 5).map((s) => ({
      id: s.id,
      payer: s.payer,
      amount: s.authorized_amount,
      status: s.status,
      createdAt: s.created_at,
    }));

    log.debug('Operator stats fetched', {
      userId: auth.userId,
      totalSessions: userSessions?.length || 0,
    });

    return NextResponse.json(
      {
        activeSessions: statusCounts.active,
        totalCaptured: totalCaptured.toString(),
        pendingAmount: pendingAmount.toString(),
        apiKeys: apiKeysCount || 0,
        statusDistribution: statusCounts,
        totalSessions: userSessions?.length || 0,
        recentSessions,
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('Stats error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
