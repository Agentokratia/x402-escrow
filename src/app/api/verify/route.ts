import { NextResponse } from 'next/server';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { supabase, getNetworkFromString, getSessionBalance, type DbSession } from '@/lib/db';
import {
  extractBearerToken,
  validateApiKey,
  hashSessionToken,
  constantTimeEqual,
} from '@/lib/auth';
import { getPaymentInfoHash, getFacilitatorAddress } from '@/lib/escrow';
import { isNonceUsed } from '@/lib/wallet';
import { safeParseVerifyRequest } from '@/lib/validation';
import { verifyERC3009Signature, parseAuthorization } from '@/lib/signature';
import { createLogger, getRequestId } from '@/lib/logger';
import {
  checkAuthRateLimit,
  checkAuthFailureRateLimit,
  getClientIp,
  rateLimitHeaders,
} from '@/lib/rate-limit';
import { ERC20_ABI, VERIFY_TIMEOUT_MS } from '@/lib/constants';
import { buildPaymentInfo } from '@/lib/helpers';
import type {
  ExactPayload,
  EscrowPayload,
  VerifyResponse,
  PaymentRequirements,
  EscrowSessionUsagePayload,
} from '@/lib/types';
import { isEscrowCreationPayload, isEscrowUsagePayload } from '@/lib/types';

/**
 * POST /api/verify - x402 v2 Facilitator API
 *
 * Verifies payment authorization without executing on-chain.
 * Routes by payload.accepted.scheme:
 *   - exact: Verify direct ERC-3009 payment (signature, balance, nonce)
 *   - escrow: Unified escrow scheme (auto-detects by payload structure):
 *     - Creation: Has signature + authorization → session creation flow
 *     - Usage: Has session.id + session.token → session debit flow
 *   - session: DEPRECATED - falls through to escrow handling
 */
export async function POST(request: Request) {
  const reqId = getRequestId(request);
  const log = createLogger(reqId);
  const clientIp = getClientIp(request);

  // Create timeout controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);

  try {
    // API key authentication
    const apiKey = extractBearerToken(request);

    // Check auth failure rate limit before validation
    const failureLimit = checkAuthFailureRateLimit(clientIp);
    if (!failureLimit.allowed) {
      log.warn('Auth failure rate limit exceeded', { ip: clientIp });
      return NextResponse.json(
        { isValid: false, invalidReason: 'rate_limited' } satisfies VerifyResponse,
        { status: 429, headers: rateLimitHeaders(failureLimit) }
      );
    }

    const { valid, userId } = await validateApiKey(apiKey);

    if (!valid || !userId) {
      log.warn('Invalid API key', { ip: clientIp });
      return NextResponse.json(
        { isValid: false, invalidReason: 'unauthorized' } satisfies VerifyResponse,
        { status: 401 }
      );
    }

    // Check rate limit for authenticated requests
    const rateLimit = checkAuthRateLimit(userId);
    if (!rateLimit.allowed) {
      log.warn('Rate limit exceeded', { userId });
      return NextResponse.json(
        { isValid: false, invalidReason: 'rate_limited' } satisfies VerifyResponse,
        { status: 429, headers: rateLimitHeaders(rateLimit) }
      );
    }

    // Parse and validate request body
    const rawBody = await request.json();
    const parseResult = safeParseVerifyRequest(rawBody);

    if (!parseResult.success) {
      log.warn('Invalid request body', { errors: parseResult.error.issues });
      return NextResponse.json(
        { isValid: false, invalidReason: 'invalid_request' } satisfies VerifyResponse,
        { status: 400 }
      );
    }

    const { paymentPayload, paymentRequirements } = parseResult.data;
    const scheme = paymentPayload.accepted.scheme;

    log.info('Verify request', { scheme, network: paymentPayload.accepted.network });

    switch (scheme) {
      case 'exact':
        return NextResponse.json(
          await verifyExact(paymentPayload as unknown as ExactPayload, paymentRequirements, log),
          { headers: rateLimitHeaders(rateLimit) }
        );

      case 'session':
        // DEPRECATED: 'session' scheme is deprecated - use 'escrow' with session payload
        log.warn(
          'DEPRECATED: "session" scheme is deprecated, use "escrow" with session payload instead'
        );
      // Convert old session payload format to new escrow usage format and fall through
      // Fall through to escrow handling (detected as usage payload)
      // Note: We need to transform the payload structure for backwards compatibility

      case 'escrow': {
        const escrowPayload = paymentPayload.payload;

        // Detect payload type and route accordingly
        if (isEscrowCreationPayload(escrowPayload)) {
          // Session CREATION: Has signature + authorization
          return NextResponse.json(
            await verifyEscrowCreation(
              paymentPayload as unknown as EscrowPayload,
              paymentRequirements,
              log
            ),
            { headers: rateLimitHeaders(rateLimit) }
          );
        }

        if (isEscrowUsagePayload(escrowPayload)) {
          // Session USAGE: Has nested session object
          return NextResponse.json(
            await verifyEscrowUsage(
              escrowPayload as EscrowSessionUsagePayload,
              paymentPayload.accepted.network as `${string}:${string}`,
              paymentRequirements,
              userId,
              log
            ),
            { headers: rateLimitHeaders(rateLimit) }
          );
        }

        // Invalid escrow payload - neither creation nor usage
        log.warn('Invalid escrow payload - missing signature or session object');
        return NextResponse.json(
          { isValid: false, invalidReason: 'invalid_payload' } satisfies VerifyResponse,
          { status: 400, headers: rateLimitHeaders(rateLimit) }
        );
      }

      default:
        log.warn('Unsupported scheme', { scheme });
        return NextResponse.json(
          { isValid: false, invalidReason: 'unsupported_scheme' } satisfies VerifyResponse,
          { status: 400, headers: rateLimitHeaders(rateLimit) }
        );
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      log.error('Request timeout', err);
      return NextResponse.json(
        { isValid: false, invalidReason: 'request_timeout' } satisfies VerifyResponse,
        { status: 504 }
      );
    }
    log.error('Verify error', err instanceof Error ? err : new Error(String(err)));
    return NextResponse.json(
      { isValid: false, invalidReason: 'internal_error' } satisfies VerifyResponse,
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

type Logger = ReturnType<typeof createLogger>;

// =============================================================================
// EXACT: Direct one-time payment verification (no escrow)
// =============================================================================

async function verifyExact(
  payload: ExactPayload,
  requirements: PaymentRequirements,
  log: Logger
): Promise<VerifyResponse> {
  try {
    const { authorization, signature } = payload.payload;

    if (!authorization || !signature) {
      return { isValid: false, invalidReason: 'invalid_payload' };
    }

    const payer = authorization.from.toLowerCase();
    log.debug('Verifying exact payment', { payer, amount: authorization.value });

    // 1. Validate network
    const network = await getNetworkFromString(payload.accepted.network);
    if (!network) {
      return { isValid: false, invalidReason: 'invalid_network', payer };
    }

    // 2. CRITICAL: Verify EIP-712 signature
    const signatureResult = await verifyERC3009Signature(
      parseAuthorization(authorization),
      signature as Hex,
      {
        name: network.usdc_eip712_name,
        version: network.usdc_eip712_version,
        chainId: network.chain_id,
        verifyingContract: network.usdc_address as Address,
      }
    );

    if (!signatureResult.valid) {
      log.warn('Invalid signature', { payer, error: signatureResult.error });
      return { isValid: false, invalidReason: 'invalid_signature', payer };
    }

    // 3. Validate payTo matches requirements
    if (payload.accepted.payTo.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return { isValid: false, invalidReason: 'invalid_recipient', payer };
    }

    // 4. Validate authorization.to matches payTo (direct transfer)
    if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return { isValid: false, invalidReason: 'authorization_recipient_mismatch', payer };
    }

    // 5. Validate asset matches requirements
    if (payload.accepted.asset.toLowerCase() !== requirements.asset.toLowerCase()) {
      return { isValid: false, invalidReason: 'invalid_asset', payer };
    }

    // 6. Validate amount meets requirements
    const paymentAmount = BigInt(authorization.value);
    const requiredAmount = BigInt(requirements.amount);
    if (paymentAmount < requiredAmount) {
      return { isValid: false, invalidReason: 'insufficient_amount', payer };
    }

    // 7. Validate time window
    const now = Math.floor(Date.now() / 1000);
    if (now < Number(authorization.validAfter)) {
      return { isValid: false, invalidReason: 'authorization_not_yet_valid', payer };
    }
    if (now >= Number(authorization.validBefore)) {
      return { isValid: false, invalidReason: 'authorization_expired', payer };
    }

    // 8. Check nonce not used
    const nonceUsed = await isNonceUsed(
      network.id,
      network.usdc_address as Address,
      authorization.from as Address,
      authorization.nonce as Hex
    );
    if (nonceUsed) {
      return { isValid: false, invalidReason: 'nonce_already_used', payer };
    }

    // 9. Check payer balance
    const publicClient = createPublicClient({ transport: http(network.rpc_url) });
    const balance = await publicClient.readContract({
      address: network.usdc_address as Address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [authorization.from as Address],
    });

    if (balance < paymentAmount) {
      return { isValid: false, invalidReason: 'insufficient_funds', payer };
    }

    log.info('Exact payment verified', { payer, amount: paymentAmount.toString() });
    return { isValid: true, payer };
  } catch (err) {
    log.error('Exact verify error', err instanceof Error ? err : new Error(String(err)));
    return { isValid: false, invalidReason: 'unexpected_verify_error' };
  }
}

// =============================================================================
// ESCROW CREATION: Session creation verification (wallet signature)
// =============================================================================

async function verifyEscrowCreation(
  payload: EscrowPayload,
  requirements: PaymentRequirements,
  log: Logger
): Promise<VerifyResponse> {
  try {
    const { authorization, sessionParams, signature, requestId } = payload.payload;

    if (!authorization || !signature || !sessionParams || !requestId) {
      return { isValid: false, invalidReason: 'invalid_payload' };
    }

    const payer = authorization.from.toLowerCase();
    log.debug('Verifying escrow session creation', { payer, requestId });

    // 1. Validate network
    const network = await getNetworkFromString(payload.accepted.network);
    if (!network || !network.escrow_contract || !network.erc3009_collector) {
      return { isValid: false, invalidReason: 'invalid_network', payer };
    }

    // 2. CRITICAL: Verify EIP-712 signature
    // Use name/version from payload extra (what client signed with) - signature binds these values
    const eip712Name = (payload.accepted.extra?.name as string) || network.usdc_eip712_name;
    const eip712Version =
      (payload.accepted.extra?.version as string) || network.usdc_eip712_version;

    const signatureResult = await verifyERC3009Signature(
      parseAuthorization(authorization),
      signature as Hex,
      {
        name: eip712Name,
        version: eip712Version,
        chainId: network.chain_id,
        verifyingContract: network.usdc_address as Address,
      },
      'ReceiveWithAuthorization' // Escrow uses ReceiveWithAuthorization
    );

    if (!signatureResult.valid) {
      log.warn('Invalid signature', { payer, error: signatureResult.error });
      return { isValid: false, invalidReason: 'invalid_signature', payer };
    }

    // 3. Validate facilitator
    const facilitatorAddress = await getFacilitatorAddress();
    if (payload.accepted.extra.facilitator.toLowerCase() !== facilitatorAddress) {
      return { isValid: false, invalidReason: 'invalid_facilitator', payer };
    }

    // 4. Validate tokenCollector
    if (authorization.to.toLowerCase() !== network.erc3009_collector.toLowerCase()) {
      return { isValid: false, invalidReason: 'invalid_token_collector', payer };
    }

    // 5. Validate payTo matches requirements
    if (payload.accepted.payTo.toLowerCase() !== requirements.payTo.toLowerCase()) {
      return { isValid: false, invalidReason: 'invalid_recipient', payer };
    }

    // 6. Validate asset matches requirements
    if (payload.accepted.asset.toLowerCase() !== requirements.asset.toLowerCase()) {
      return { isValid: false, invalidReason: 'invalid_asset', payer };
    }

    // 7. Validate deposit amount within bounds
    const depositAmount = BigInt(authorization.value);
    const minDeposit = BigInt(payload.accepted.extra.minDeposit || '0');
    const maxDeposit = BigInt(payload.accepted.extra.maxDeposit || authorization.value);

    if (depositAmount <= 0n || depositAmount < minDeposit || depositAmount > maxDeposit) {
      return { isValid: false, invalidReason: 'deposit_out_of_bounds', payer };
    }

    // 8. Validate deposit covers resource cost
    const resourceCost = BigInt(requirements.amount);
    if (depositAmount < resourceCost) {
      return { isValid: false, invalidReason: 'deposit_less_than_cost', payer };
    }

    // 9. Validate time window
    const now = Math.floor(Date.now() / 1000);
    if (now < Number(authorization.validAfter)) {
      return { isValid: false, invalidReason: 'authorization_not_yet_valid', payer };
    }
    if (now >= Number(authorization.validBefore)) {
      return { isValid: false, invalidReason: 'authorization_expired', payer };
    }

    // 10. Validate session expiry is in future and within authorization window
    if (sessionParams.authorizationExpiry <= now) {
      return { isValid: false, invalidReason: 'session_expiry_invalid', payer };
    }
    if (sessionParams.authorizationExpiry > Number(authorization.validBefore)) {
      return { isValid: false, invalidReason: 'session_expiry_exceeds_authorization', payer };
    }

    // 11. Check nonce not used
    const nonceUsed = await isNonceUsed(
      network.id,
      network.usdc_address as Address,
      authorization.from as Address,
      authorization.nonce as Hex
    );
    if (nonceUsed) {
      return { isValid: false, invalidReason: 'nonce_already_used', payer };
    }

    // 12. Check payer balance
    const publicClient = createPublicClient({ transport: http(network.rpc_url) });
    const balance = await publicClient.readContract({
      address: network.usdc_address as Address,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [authorization.from as Address],
    });

    if (balance < depositAmount) {
      return { isValid: false, invalidReason: 'insufficient_funds', payer };
    }

    // 13. Check if session already exists (idempotency)
    const paymentInfo = buildPaymentInfo({
      facilitator: payload.accepted.extra.facilitator,
      authorization,
      payTo: payload.accepted.payTo,
      asset: payload.accepted.asset,
      sessionParams,
    });

    const sessionId = await getPaymentInfoHash(payload.accepted.network, paymentInfo);
    const { data: existingSession } = await supabase
      .from('sessions')
      .select('id, status')
      .eq('id', sessionId)
      .single<Pick<DbSession, 'id' | 'status'>>();

    if (existingSession?.status === 'active') {
      log.info('Session already exists (idempotent)', { sessionId, payer });
      return { isValid: true, payer }; // Idempotent
    }
    if (existingSession) {
      return { isValid: false, invalidReason: 'session_inactive', payer };
    }

    log.info('Escrow session verified', { payer, depositAmount: depositAmount.toString() });
    return { isValid: true, payer };
  } catch (err) {
    log.error('Escrow verify error', err instanceof Error ? err : new Error(String(err)));
    return { isValid: false, invalidReason: 'unexpected_verify_error' };
  }
}

// =============================================================================
// ESCROW USAGE: Existing session debit verification (token-based)
// =============================================================================

async function verifyEscrowUsage(
  payload: EscrowSessionUsagePayload,
  networkId: `${string}:${string}`,
  requirements: PaymentRequirements,
  userId: string,
  log: Logger
): Promise<VerifyResponse> {
  try {
    const { session, requestId, amount } = payload;

    // Validate nested session object
    if (!session?.id || !session?.token || !requestId) {
      return { isValid: false, invalidReason: 'invalid_payload' };
    }

    const sessionId = session.id;
    const sessionToken = session.token;

    const debitAmount = BigInt(amount || requirements.amount);
    log.debug('Verifying session debit', { sessionId, requestId, amount: debitAmount.toString() });

    // 1. Get session from database
    const { data: dbSession } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single<DbSession>();

    if (!dbSession) {
      return { isValid: false, invalidReason: 'session_not_found' };
    }

    const payer = dbSession.payer;

    // 2. Check session ownership - only the API key owner who created the session can use it
    if (dbSession.user_id !== userId) {
      return { isValid: false, invalidReason: 'session_not_found', payer };
    }

    // 3. Validate network matches session's network
    const network = await getNetworkFromString(networkId);
    if (!network || network.id !== dbSession.network_id) {
      return { isValid: false, invalidReason: 'network_mismatch', payer };
    }

    // 4. Verify session token (required)
    // Uses constant-time comparison to prevent timing attacks
    if (!dbSession.session_token_hash) {
      return { isValid: false, invalidReason: 'session_token_not_configured', payer };
    }
    const providedTokenHash = hashSessionToken(sessionToken);
    if (!constantTimeEqual(providedTokenHash, dbSession.session_token_hash)) {
      return { isValid: false, invalidReason: 'invalid_session_token', payer };
    }

    // 5. Check session status
    if (dbSession.status !== 'active') {
      return { isValid: false, invalidReason: 'session_inactive', payer };
    }

    // 6. Check session not expired
    const expiryTime = new Date(dbSession.authorization_expiry).getTime();
    if (Date.now() >= expiryTime) {
      return { isValid: false, invalidReason: 'session_expired', payer };
    }

    // 7. Check balance
    const balance = await getSessionBalance(sessionId);
    if (!balance || BigInt(balance.available_amount) < debitAmount) {
      return { isValid: false, invalidReason: 'insufficient_balance', payer };
    }

    // 8. Check for duplicate requestId (idempotency)
    const { data: existingLog } = await supabase
      .from('usage_logs')
      .select('id')
      .eq('session_id', sessionId)
      .eq('request_id', requestId)
      .single();

    if (existingLog) {
      log.info('Duplicate requestId (idempotent)', { sessionId, requestId });
      // Idempotent - same request already processed
      return { isValid: true, payer };
    }

    log.info('Session debit verified', { sessionId, payer, amount: debitAmount.toString() });
    return { isValid: true, payer };
  } catch (err) {
    log.error('Session verify error', err instanceof Error ? err : new Error(String(err)));
    return { isValid: false, invalidReason: 'unexpected_verify_error' };
  }
}
