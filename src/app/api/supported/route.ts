import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import { getFacilitatorAddress } from '@/lib/escrow';
import { createLogger, getRequestId } from '@/lib/logger';
import { checkSupportedRateLimit, getClientIp, rateLimitHeaders } from '@/lib/rate-limit';

// Cache for /supported response (60 seconds TTL)
const CACHE_TTL_MS = 60_000;
let cachedResponse: { data: unknown; timestamp: number } | null = null;

function getCachedResponse(): unknown | null {
  if (!cachedResponse) return null;
  if (Date.now() - cachedResponse.timestamp > CACHE_TTL_MS) {
    cachedResponse = null;
    return null;
  }
  return cachedResponse.data;
}

function setCachedResponse(data: unknown): void {
  cachedResponse = { data, timestamp: Date.now() };
}

/**
 * GET /api/supported - x402 v2 Standard API
 *
 * Returns: { kinds, extensions, signers }
 */
export async function GET(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);
  const clientIp = getClientIp(request);

  try {
    // Rate limit check (public endpoint, by IP)
    const rateLimit = checkSupportedRateLimit(clientIp);
    if (!rateLimit.allowed) {
      log.warn('Rate limit exceeded', { ip: clientIp });
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Check cache first
    const cached = getCachedResponse();
    if (cached) {
      log.debug('Returning cached response');
      return NextResponse.json(cached, { headers: rateLimitHeaders(rateLimit) });
    }

    const { data: networks, error } = await supabase
      .from('networks')
      .select('*')
      .eq('is_active', true)
      .order('chain_id');

    if (error) {
      log.error('Failed to fetch networks', new Error(error.message));
      return NextResponse.json(
        { error: 'Failed to fetch networks' },
        { status: 500, headers: rateLimitHeaders(rateLimit) }
      );
    }

    const facilitator = await getFacilitatorAddress();
    const kinds: Record<string, unknown>[] = [];
    const signers: Record<string, string[]> = {};

    for (const n of networks ?? []) {
      signers[n.id] = [facilitator];

      const base = {
        x402Version: 2,
        network: n.id,
        asset: n.usdc_address,
      };

      const eip712 = {
        name: n.usdc_eip712_name,
        version: n.usdc_eip712_version,
      };

      // exact - x402 v2 standard
      kinds.push({
        ...base,
        scheme: 'exact',
        extra: eip712,
      });

      // Extensions require escrow contract
      if (!n.escrow_contract || !n.erc3009_collector) continue;

      const escrowExtra = {
        ...eip712,
        facilitator,
        escrowContract: n.escrow_contract,
        tokenCollector: n.erc3009_collector,
      };

      // escrow - unified scheme (handles both creation and usage)
      // Session creation: Client sends signature + authorization (wallet signed)
      // Session usage: Client sends session.id + session.token (no signature)
      // Use DB values if set, otherwise use defaults with warning
      const minDeposit = n.min_deposit || '5000000';
      const maxDeposit = n.max_deposit || '100000000';
      if (!n.min_deposit || !n.max_deposit) {
        log.warn('Using default deposit limits - configure in networks table', {
          network: n.id,
          minDeposit,
          maxDeposit,
        });
      }
      kinds.push({
        ...base,
        scheme: 'escrow',
        extra: {
          ...escrowExtra,
          minDeposit,
          maxDeposit,
        },
      });

      // NOTE: 'session' scheme removed - now handled within 'escrow' via payload detection
    }

    log.debug('Supported request', {
      kindsCount: kinds.length,
      networksCount: networks?.length || 0,
    });

    const responseData = {
      kinds,
      // Agentokratia extension - enables marketplace features like dynamic agent registration
      extensions: ['agentokratia'],
      signers,
    };

    // Cache the response
    setCachedResponse(responseData);

    return NextResponse.json(responseData, { headers: rateLimitHeaders(rateLimit) });
  } catch (err) {
    log.error('Supported endpoint error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
