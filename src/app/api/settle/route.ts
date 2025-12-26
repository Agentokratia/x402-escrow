import { NextResponse } from 'next/server';
import { type Hex } from 'viem';
import { supabase, getNetworkFromString, getSessionBalance, type DbSession } from '@/lib/db';
import {
  extractBearerToken,
  validateApiKey,
  generateSessionToken,
  hashSessionToken,
  constantTimeEqual,
} from '@/lib/auth';
import {
  authorize as authorizeOnChain,
  capture,
  getPaymentInfoHash,
  sessionToPaymentInfo,
} from '@/lib/escrow';
import { executeTransferWithAuthorization } from '@/lib/wallet';
import { safeParseSettleRequest } from '@/lib/validation';
import { createLogger, getRequestId } from '@/lib/logger';
import {
  checkAuthRateLimit,
  checkAuthFailureRateLimit,
  getClientIp,
  rateLimitHeaders,
} from '@/lib/rate-limit';
import { ZERO_ADDRESS, SETTLE_TIMEOUT_MS, TIER3_THRESHOLD_MS } from '@/lib/constants';
import { buildPaymentInfo } from '@/lib/helpers';
import type {
  ExactPayload,
  EscrowPayload,
  SettleResponse,
  PaymentRequirements,
  EscrowSessionUsagePayload,
} from '@/lib/types';
import { isEscrowCreationPayload, isEscrowUsagePayload } from '@/lib/types';

/**
 * POST /api/settle - x402 v2 Facilitator API
 *
 * Executes payment settlement on-chain.
 * Routes by payload.accepted.scheme:
 *   - exact: Execute ERC-3009 transferWithAuthorization - direct payment
 *   - escrow: Unified escrow scheme (auto-detects by payload structure):
 *     - Creation: Has signature + authorization → authorize() + debit first charge
 *     - Usage: Has session.id + session.token → debit from existing session
 *   - session: DEPRECATED - falls through to escrow handling
 */
export async function POST(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);
  const clientIp = getClientIp(request);

  // Create timeout controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SETTLE_TIMEOUT_MS);

  try {
    // API key authentication
    const apiKey = extractBearerToken(request);

    // Check auth failure rate limit before validation
    const failureLimit = checkAuthFailureRateLimit(clientIp);
    if (!failureLimit.allowed) {
      log.warn('Auth failure rate limit exceeded', { ip: clientIp });
      return NextResponse.json(
        { success: false, errorReason: 'rate_limited', transaction: '', network: '' },
        { status: 429, headers: rateLimitHeaders(failureLimit) }
      );
    }

    const { valid, userId } = await validateApiKey(apiKey);

    if (!valid || !userId) {
      log.warn('Invalid API key', { ip: clientIp });
      return NextResponse.json(
        { success: false, errorReason: 'unauthorized', transaction: '', network: '' },
        { status: 401 }
      );
    }

    // Check rate limit for authenticated requests
    const rateLimit = checkAuthRateLimit(userId);
    if (!rateLimit.allowed) {
      log.warn('Rate limit exceeded', { userId });
      return NextResponse.json(
        { success: false, errorReason: 'rate_limited', transaction: '', network: '' },
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Parse and validate request body
    const rawBody = await request.json();
    const parseResult = safeParseSettleRequest(rawBody);

    if (!parseResult.success) {
      log.warn('Invalid request body', { errors: parseResult.error.issues });
      return NextResponse.json(
        { success: false, errorReason: 'invalid_request', transaction: '', network: '' },
        { status: 400 }
      );
    }

    const { paymentPayload, paymentRequirements } = parseResult.data;
    const scheme = paymentPayload.accepted.scheme;

    log.info('Settle request', { scheme, network: paymentPayload.accepted.network });

    switch (scheme) {
      case 'exact': {
        const payload = paymentPayload as unknown as ExactPayload;
        const result = await settleExact(payload, paymentRequirements, reqId, log);
        return NextResponse.json(result, { headers: rateLimitHeaders(rateLimit) });
      }

      case 'session':
        // DEPRECATED: 'session' scheme is deprecated - use 'escrow' with session payload
        log.warn(
          'DEPRECATED: "session" scheme is deprecated, use "escrow" with session payload instead'
        );
      // Fall through to escrow handling (detected as usage payload)

      case 'escrow': {
        const escrowPayload = paymentPayload.payload;

        // Detect payload type and route accordingly
        if (isEscrowCreationPayload(escrowPayload)) {
          // Session CREATION: Has signature + authorization
          const payload = paymentPayload as unknown as EscrowPayload;
          const result = await settleEscrowCreation(payload, paymentRequirements, userId, log);
          return NextResponse.json(result, { headers: rateLimitHeaders(rateLimit) });
        }

        if (isEscrowUsagePayload(escrowPayload)) {
          // Session USAGE: Has nested session object
          const result = await settleEscrowUsage(
            escrowPayload as EscrowSessionUsagePayload,
            paymentPayload.accepted.network as `${string}:${string}`,
            paymentRequirements,
            userId,
            log
          );
          return NextResponse.json(result, { headers: rateLimitHeaders(rateLimit) });
        }

        // Invalid escrow payload - neither creation nor usage
        log.warn('Invalid escrow payload - missing signature or session object');
        return NextResponse.json(
          {
            success: false,
            errorReason: 'invalid_payload',
            transaction: '',
            network: paymentPayload.accepted.network,
          } satisfies SettleResponse,
          { status: 400, headers: rateLimitHeaders(rateLimit) }
        );
      }

      default:
        log.warn('Unsupported scheme', { scheme });
        return NextResponse.json(
          {
            success: false,
            errorReason: 'unsupported_scheme',
            transaction: '',
            network: paymentPayload.accepted.network,
          } satisfies SettleResponse,
          { status: 400, headers: rateLimitHeaders(rateLimit) }
        );
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.error('Request timeout', err);
      return NextResponse.json(
        { success: false, errorReason: 'request_timeout', transaction: '', network: '' },
        { status: 504 }
      );
    }
    log.error('Settle error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json(
      { success: false, errorReason: 'internal_error', transaction: '', network: '' },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

type Logger = ReturnType<typeof createLogger>;

// =============================================================================
// EXACT: Direct one-time payment via ERC-3009 (no escrow)
// =============================================================================

async function settleExact(
  payload: ExactPayload,
  requirements: PaymentRequirements,
  requestId: string,
  log: Logger
): Promise<SettleResponse> {
  try {
    const { authorization, signature } = payload.payload;
    const network = payload.accepted.network;
    const payer = authorization.from.toLowerCase();

    log.info('Settling exact payment', { payer, amount: authorization.value });

    // Validate network
    const networkConfig = await getNetworkFromString(network);
    if (!networkConfig) {
      return { success: false, errorReason: 'invalid_network', payer, transaction: '', network };
    }

    // Idempotency: ERC-3009 nonce provides atomic on-chain idempotency.
    // If the same authorization is submitted twice, the second call will fail
    // because the nonce has already been marked as used in the USDC contract.
    // This is intentional - on-chain nonce is the canonical source of truth.
    // No DB-level tracking needed since blockchain state is authoritative.

    // Execute direct transfer via ERC-3009 transferWithAuthorization
    const result = await executeTransferWithAuthorization(
      network,
      networkConfig.usdc_address as `0x${string}`,
      authorization.from as `0x${string}`,
      authorization.to as `0x${string}`, // Direct to payTo (receiver)
      BigInt(authorization.value),
      BigInt(authorization.validAfter),
      BigInt(authorization.validBefore),
      authorization.nonce as Hex,
      signature as Hex
    );

    if (!result.success) {
      log.error('Exact settle failed', new Error(result.error || 'transfer_failed'), { payer });
      return {
        success: false,
        errorReason: result.error || 'transfer_failed',
        payer,
        transaction: '',
        network,
      };
    }

    log.info('Exact payment settled', { payer, txHash: result.txHash });
    return {
      success: true,
      payer,
      transaction: result.txHash || '',
      network,
    };
  } catch (err) {
    log.error('Exact settle error', err instanceof Error ? err : new Error(String(err)));
    return {
      success: false,
      errorReason: 'unexpected_settle_error',
      transaction: '',
      network: payload.accepted.network,
    };
  }
}

// =============================================================================
// ESCROW CREATION: Create session + debit first charge (wallet signature)
// =============================================================================

async function settleEscrowCreation(
  payload: EscrowPayload,
  requirements: PaymentRequirements,
  userId: string,
  log: Logger
): Promise<SettleResponse> {
  const { authorization, sessionParams, signature, requestId } = payload.payload;
  const network = payload.accepted.network;
  const payer = authorization.from.toLowerCase();
  const depositAmount = BigInt(authorization.value);
  const resourceCost = BigInt(requirements.amount);

  log.info('Settling escrow session', {
    payer,
    requestId,
    depositAmount: depositAmount.toString(),
  });

  // Validate network
  const networkConfig = await getNetworkFromString(network);
  if (!networkConfig) {
    return {
      success: false,
      errorReason: 'invalid_network',
      payer,
      transaction: '',
      network,
    };
  }

  // Build PaymentInfo
  const paymentInfo = buildPaymentInfo({
    facilitator: payload.accepted.extra.facilitator,
    authorization,
    payTo: payload.accepted.payTo,
    asset: payload.accepted.asset,
    sessionParams,
  });

  // Get session ID
  const sessionId = await getPaymentInfoHash(network, paymentInfo);

  // Check idempotency - if session exists and is active, just debit
  const { data: existingSession } = await supabase
    .from('sessions')
    .select('id, status, authorize_tx_hash, authorization_expiry')
    .eq('id', sessionId)
    .single<Pick<DbSession, 'id' | 'status' | 'authorize_tx_hash' | 'authorization_expiry'>>();

  if (existingSession?.status === 'active') {
    log.info('Session exists, debiting (idempotent)', { sessionId, requestId });
    // Session exists - just debit the resource cost (idempotent for requestId)
    const { error: debitError } = await supabase.rpc('debit_session', {
      p_session_id: sessionId,
      p_amount: resourceCost.toString(),
      p_request_id: requestId,
      p_description: 'Initial request charge',
    });

    if (debitError) {
      log.error('Debit error on existing session', new Error(debitError.message), { sessionId });
    }

    const balance = await getSessionBalance(sessionId);

    return {
      success: true,
      payer,
      transaction: existingSession.authorize_tx_hash || sessionId,
      network,
      session: {
        id: sessionId,
        balance: balance?.available_amount || '0',
        // Token was already issued on creation, not available again
        expiresAt: new Date(existingSession.authorization_expiry).getTime() / 1000,
      },
    };
  }

  if (existingSession) {
    return {
      success: false,
      errorReason: 'session_inactive',
      payer,
      transaction: '',
      network,
    };
  }

  // Generate session token (secret, shown only once)
  const sessionToken = generateSessionToken();
  const sessionTokenHash = hashSessionToken(sessionToken);

  // Execute on-chain authorization
  const tokenCollector = payload.accepted.extra.tokenCollector;
  const collectorData = signature as Hex;

  const escrowResult = await authorizeOnChain(
    network,
    paymentInfo,
    depositAmount,
    tokenCollector,
    collectorData
  );

  if (!escrowResult.success) {
    log.error('Escrow authorization failed', new Error(escrowResult.error || 'unknown'), {
      payer,
      sessionId,
    });
    return {
      success: false,
      errorReason: escrowResult.error || 'escrow_authorization_failed',
      payer,
      transaction: '',
      network,
    };
  }

  log.info('On-chain authorization success', { sessionId, txHash: escrowResult.txHash });

  // Create session in database
  const { error: insertError } = await supabase.from('sessions').insert({
    id: sessionId,
    network_id: networkConfig.id,
    payer: payer,
    receiver: payload.accepted.payTo.toLowerCase(),
    user_id: userId,
    token: payload.accepted.asset.toLowerCase(),
    authorized_amount: depositAmount.toString(),
    captured_amount: '0',
    pending_amount: '0',
    authorization_expiry: new Date(sessionParams.authorizationExpiry * 1000).toISOString(),
    refund_expiry: new Date(sessionParams.refundExpiry * 1000).toISOString(),
    status: 'active',
    authorize_tx_hash: escrowResult.txHash || null,
    operator: payload.accepted.extra.facilitator.toLowerCase(),
    salt: sessionParams.salt,
    pre_approval_expiry: new Date(Number(authorization.validBefore) * 1000).toISOString(),
    min_fee_bps: 0,
    max_fee_bps: 0,
    fee_receiver: ZERO_ADDRESS,
    session_token_hash: sessionTokenHash, // Store hash, return raw token to client
  });

  if (insertError) {
    // Handle race condition
    if (insertError.code === '23505') {
      log.info('Race condition detected, fetching existing session', { sessionId });
      const { data: raceSession } = await supabase
        .from('sessions')
        .select('id, status, authorize_tx_hash, authorization_expiry')
        .eq('id', sessionId)
        .single<Pick<DbSession, 'id' | 'status' | 'authorize_tx_hash' | 'authorization_expiry'>>();

      if (raceSession?.status === 'active') {
        // Debit the first charge
        await supabase.rpc('debit_session', {
          p_session_id: sessionId,
          p_amount: resourceCost.toString(),
          p_request_id: requestId,
          p_description: 'Initial request charge',
        });

        const balance = await getSessionBalance(sessionId);

        return {
          success: true,
          payer,
          transaction: raceSession.authorize_tx_hash || sessionId,
          network,
          session: {
            id: sessionId,
            balance: balance?.available_amount || '0',
            // Token was issued by the winning race, not available
            expiresAt: new Date(raceSession.authorization_expiry).getTime() / 1000,
          },
        };
      }
    }

    log.error('Failed to create session', new Error(insertError.message), { sessionId });
    return {
      success: false,
      errorReason: 'db_error',
      payer,
      transaction: '',
      network,
    };
  }

  // Debit the first charge (resource cost)
  const { error: debitError } = await supabase.rpc('debit_session', {
    p_session_id: sessionId,
    p_amount: resourceCost.toString(),
    p_request_id: requestId,
    p_description: 'Initial request charge',
  });

  // Get actual balance from DB (handles debit failure case correctly)
  let remainingBalance: string;
  if (debitError) {
    log.error('Failed to debit initial charge', new Error(debitError.message), { sessionId });
    // Debit failed - fetch actual balance from DB
    const actualBalance = await getSessionBalance(sessionId);
    remainingBalance = actualBalance?.available_amount || depositAmount.toString();
  } else {
    // Debit succeeded - calculate remaining (faster than DB query)
    remainingBalance = (depositAmount - resourceCost).toString();
  }

  log.info('Session created successfully', { sessionId, balance: remainingBalance });
  return {
    success: true,
    payer,
    transaction: escrowResult.txHash || sessionId,
    network,
    session: {
      id: sessionId,
      token: sessionToken, // Secret - client must save, shown only once
      balance: remainingBalance,
      expiresAt: sessionParams.authorizationExpiry,
    },
  };
}

// =============================================================================
// ESCROW USAGE: Debit from existing session (token-based)
// =============================================================================

async function settleEscrowUsage(
  payload: EscrowSessionUsagePayload,
  networkId: `${string}:${string}`,
  requirements: PaymentRequirements,
  userId: string,
  log: Logger
): Promise<SettleResponse> {
  const { session, requestId, amount } = payload;

  // Validate nested session object
  if (!session?.id || !session?.token || !requestId) {
    return {
      success: false,
      errorReason: 'invalid_payload',
      transaction: '',
      network: networkId,
    };
  }

  const sessionId = session.id;
  const sessionToken = session.token;
  const debitAmount = amount || requirements.amount;

  log.info('Settling session debit', { sessionId, requestId, amount: debitAmount });

  // Get session from database
  const { data: dbSession } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single<DbSession>();

  if (!dbSession) {
    return {
      success: false,
      errorReason: 'session_not_found',
      transaction: '',
      network: networkId,
    };
  }

  const payer = dbSession.payer;

  // Check session ownership - only the API key owner who created the session can use it
  if (dbSession.user_id !== userId) {
    return {
      success: false,
      errorReason: 'session_not_found',
      payer,
      transaction: '',
      network: networkId,
    };
  }

  // Validate network matches session's network
  const networkConfig = await getNetworkFromString(networkId);
  if (!networkConfig || networkConfig.id !== dbSession.network_id) {
    return {
      success: false,
      errorReason: 'network_mismatch',
      payer,
      transaction: '',
      network: networkId,
    };
  }

  // Verify session token (required)
  // Uses constant-time comparison to prevent timing attacks
  if (!dbSession.session_token_hash) {
    return {
      success: false,
      errorReason: 'session_token_not_configured',
      payer,
      transaction: '',
      network: networkId,
    };
  }
  const providedTokenHash = hashSessionToken(sessionToken);
  if (!constantTimeEqual(providedTokenHash, dbSession.session_token_hash)) {
    return {
      success: false,
      errorReason: 'invalid_session_token',
      payer,
      transaction: '',
      network: networkId,
    };
  }

  // Check expiry
  const expiryTime = new Date(dbSession.authorization_expiry).getTime();
  const timeToExpiry = expiryTime - Date.now();

  if (timeToExpiry <= 0) {
    return {
      success: false,
      errorReason: 'session_expired',
      payer,
      transaction: '',
      network: networkId,
    };
  }

  // Check status
  if (dbSession.status !== 'active') {
    return {
      success: false,
      errorReason: 'session_inactive',
      payer,
      transaction: '',
      network: networkId,
    };
  }

  // TIER 3: Sync capture if < 30 min to expiry
  const balance = await getSessionBalance(sessionId);
  const pendingAmount = BigInt(balance?.pending_amount || '0');

  if (timeToExpiry < TIER3_THRESHOLD_MS && pendingAmount > 0n) {
    log.info('TIER 3: Sync capture triggered', {
      sessionId,
      pendingAmount: pendingAmount.toString(),
    });
    const paymentInfo = sessionToPaymentInfo(dbSession);
    const captureResult = await capture(dbSession.network_id, paymentInfo, pendingAmount);

    if (captureResult.success) {
      // Update DB: mark pending usage_logs as settled
      await supabase.rpc('sync_capture', {
        p_session_id: sessionId,
        p_amount: pendingAmount.toString(),
        p_tx_hash: captureResult.txHash || null,
      });
      log.info('TIER 3: Capture success', { sessionId, txHash: captureResult.txHash });
    } else {
      log.error('TIER 3: Capture failed', new Error(captureResult.error || 'unknown'), {
        sessionId,
      });
      return {
        success: false,
        errorReason: 'tier3_capture_failed',
        payer,
        transaction: '',
        network: networkId,
      };
    }
  }

  // Atomic debit
  const { data: result, error } = await supabase.rpc('debit_session', {
    p_session_id: sessionId,
    p_amount: debitAmount,
    p_request_id: requestId,
    p_description: null,
  });

  if (error) {
    log.error('Debit RPC error', new Error(error.message), { sessionId, requestId });
    return {
      success: false,
      errorReason: 'debit_failed',
      payer,
      transaction: '',
      network: networkId,
    };
  }

  const debitResult = result[0];
  if (!debitResult.success) {
    log.warn('Debit failed', { sessionId, errorCode: debitResult.error_code });
    return {
      success: false,
      errorReason: debitResult.error_code,
      payer,
      transaction: '',
      network: networkId,
    };
  }

  log.info('Session debit success', { sessionId, remaining: debitResult.available });
  // Return balance so client can update local session state
  return {
    success: true,
    payer,
    transaction: dbSession.authorize_tx_hash || sessionId,
    network: networkId,
    session: {
      id: sessionId,
      balance: debitResult.available.toString(),
    },
  };
}
