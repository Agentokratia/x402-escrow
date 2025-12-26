import { NextResponse } from 'next/server';
import { z } from 'zod';
import { supabase, getNetwork, type DbSession, type DbSessionBalance } from '@/lib/db';
import { getAuthenticatedUser } from '@/lib/auth/session';
import { applyStatusFilter, getEffectiveStatus } from '@/lib/session-filters';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkManagementRateLimit, rateLimitHeaders } from '@/lib/rate-limit';

// Zod schema for query params validation
const queryParamsSchema = z.object({
  status: z.enum(['active', 'expired', 'voided', 'captured']).optional(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

// GET /api/sessions - List incoming sessions (created via user's API key)
export async function GET(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);

  try {
    const { searchParams } = new URL(request.url);

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

    // Parse and validate query params
    const parseResult = queryParamsSchema.safeParse({
      status: searchParams.get('status') || undefined,
      limit: searchParams.get('limit') || 50,
      offset: searchParams.get('offset') || 0,
    });

    if (!parseResult.success) {
      log.warn('Invalid query params', { errors: parseResult.error.issues });
      return NextResponse.json(
        { error: 'Invalid query parameters', details: parseResult.error.issues },
        { status: 400, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const { status, limit, offset } = parseResult.data;

    // Show all sessions created via this user's API key
    let query = supabase
      .from('sessions')
      .select('*', { count: 'exact' })
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    query = applyStatusFilter(query, status || null);

    const { data: sessions, error, count } = await query.returns<DbSession[]>();

    if (error) {
      log.error('Failed to list sessions', new Error(error.message));
      return NextResponse.json(
        { error: 'Failed to list sessions' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Get network info and session balances in parallel
    const sessionIds = sessions?.map((s) => s.id) || [];
    const networkIds = [...new Set(sessions?.map((s) => s.network_id) || [])];

    const [networks, balancesResult] = await Promise.all([
      Promise.all(networkIds.map((id) => getNetwork(id))),
      sessionIds.length > 0
        ? supabase
            .from('session_balances')
            .select('*')
            .in('session_id', sessionIds)
            .returns<DbSessionBalance[]>()
        : Promise.resolve({ data: [] }),
    ]);

    const networkMap = new Map(
      networks.filter(Boolean).map((n) => [
        n!.id,
        {
          name: n!.name,
          blockExplorerUrl: n!.block_explorer_url,
        },
      ])
    );
    const balanceMap = new Map((balancesResult.data || []).map((b) => [b.session_id, b]));

    log.debug('Operator sessions listed', { userId: auth.userId, count: sessions?.length || 0 });

    // Return sessions with balance breakdown from view
    return NextResponse.json(
      {
        sessions:
          sessions?.map((s) => {
            const status = getEffectiveStatus(s);
            const balance = balanceMap.get(s.id);
            const available =
              status === 'active' ? BigInt(balance?.available_amount || '0') : BigInt(0);
            const networkInfo = networkMap.get(s.network_id);

            return {
              id: s.id,
              networkId: s.network_id,
              networkName: networkInfo?.name || s.network_id,
              payer: s.payer,
              receiver: s.receiver,
              status,
              balance: {
                authorized: balance?.authorized_amount || s.authorized_amount,
                captured: balance?.captured_amount || '0',
                pending: balance?.pending_amount || '0',
                available: available.toString(),
              },
              authorizationExpiry: s.authorization_expiry,
              refundExpiry: s.refund_expiry,
              createdAt: s.created_at,
              blockExplorerUrl: networkInfo?.blockExplorerUrl || null,
              authorizeTxHash: s.authorize_tx_hash,
              voidTxHash: s.void_tx_hash,
            };
          }) || [],
        total: count || 0,
        limit,
        offset,
      },
      { headers: rateLimitHeaders(rateLimit) }
    );
  } catch (err) {
    log.error('List sessions error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
