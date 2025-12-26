/**
 * Escrow Client Scheme (Unified)
 *
 * Thin orchestrator that delegates to:
 * - SessionManager: Session lifecycle management
 * - Signer (eip712.ts): EIP-712 signing for session creation
 *
 * Handles both session CREATION and session USAGE in a single scheme.
 * - First call: Creates session with wallet signature (EIP-712)
 * - Subsequent calls: Uses stored session token (no signature needed)
 */

import { toHex, getAddress, type WalletClient, type Address, type Hex } from 'viem';
import {
  generateRequestId,
  generateRandomBytes,
  type PaymentRequirements,
  type Network,
} from '../types';
import { ZERO_ADDRESS, DEFAULT_SESSION_DURATION, DEFAULT_REFUND_WINDOW } from '../constants';
import { SessionManager } from './session-manager';
import { signERC3009, computeEscrowNonce, type EIP712Domain } from './eip712';

// ============================================================================
// Types
// ============================================================================

interface PaymentPayload {
  x402Version: number;
  resource?: { url: string; description?: string; mimeType?: string };
  accepted?: PaymentRequirements;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

interface SchemeNetworkClient {
  readonly scheme: string;
  createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>>;
}

interface EscrowExtra {
  escrowContract: Address;
  facilitator: Address;
  tokenCollector: Address;
  name: string;
  version: string;
  minDeposit?: string;
  maxDeposit?: string;
}

// ============================================================================
// Options
// ============================================================================

export interface EscrowSchemeOptions {
  /** Session duration in seconds (default: 1 hour) */
  sessionDuration?: number;
  /** Refund window after session expires (default: 24 hours) */
  refundWindow?: number;
  /** Storage type: 'memory' (default) or 'localStorage' */
  storage?: 'memory' | 'localStorage';
  /** localStorage key (default: 'x402-sessions') */
  storageKey?: string;
  /**
   * Custom deposit amount in atomic units (e.g., "10000000" for $10 USDC).
   * Must be between minDeposit and maxDeposit from the 402 response.
   * If not specified, defaults to maxDeposit for maximum flexibility.
   */
  depositAmount?: string;
}

// ============================================================================
// Escrow Scheme
// ============================================================================

/**
 * Escrow payment scheme for x402 (Unified).
 *
 * Orchestrates:
 * - SessionManager for session lookup and storage
 * - EIP-712 signer for session creation signatures
 *
 * Auto-preference: If a valid session exists for the receiver,
 * it will be used automatically (no wallet interaction required).
 */
export class EscrowScheme implements SchemeNetworkClient {
  readonly scheme = 'escrow';

  /** Session manager - use directly for session operations */
  readonly sessions: SessionManager;

  private readonly wallet: WalletClient;
  private readonly chainId: number;
  readonly network: Network;
  private readonly sessionDuration: number;
  private readonly refundWindow: number;
  private readonly customDepositAmount?: bigint;

  constructor(walletClient: WalletClient, options: EscrowSchemeOptions = {}) {
    if (!walletClient.account) {
      throw new Error('WalletClient must have an account');
    }
    if (!walletClient.chain) {
      throw new Error('WalletClient must have a chain');
    }

    this.wallet = walletClient;
    this.chainId = walletClient.chain.id;
    this.network = `eip155:${walletClient.chain.id}`;
    this.sessionDuration = options.sessionDuration ?? DEFAULT_SESSION_DURATION;
    this.refundWindow = options.refundWindow ?? DEFAULT_REFUND_WINDOW;
    this.customDepositAmount = options.depositAmount ? BigInt(options.depositAmount) : undefined;
    this.sessions = new SessionManager(this.network, {
      storage: options.storage,
      storageKey: options.storageKey,
    });
  }

  get address(): Address {
    return this.wallet.account!.address;
  }

  // ========== Payment Payload Creation ==========

  /**
   * Creates payment payload for escrow scheme.
   * Auto-detects whether to create new session or use existing one.
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>> {
    const receiver = getAddress(paymentRequirements.payTo);
    const amount = BigInt(paymentRequirements.amount);

    // Check for existing session (auto-preference)
    const existingSession = this.sessions.findBest(receiver, amount);

    if (existingSession) {
      return this.createUsagePayload(x402Version, existingSession, paymentRequirements.amount);
    }

    return this.createCreationPayload(x402Version, paymentRequirements);
  }

  // ========== Private: Payload Builders ==========

  /**
   * Session USAGE payload - uses existing session (no signature).
   */
  private createUsagePayload(
    x402Version: number,
    session: { sessionId: string; sessionToken: string },
    amount: string
  ): Pick<PaymentPayload, 'x402Version' | 'payload'> {
    return {
      x402Version,
      payload: {
        session: {
          id: session.sessionId,
          token: session.sessionToken,
        },
        amount,
        requestId: generateRequestId(),
      },
    };
  }

  /**
   * Session CREATION payload - requires wallet signature.
   */
  private async createCreationPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements
  ): Promise<Pick<PaymentPayload, 'x402Version' | 'payload'>> {
    const extra = paymentRequirements.extra as unknown as EscrowExtra;

    if (!extra.escrowContract || !extra.facilitator || !extra.tokenCollector) {
      throw new Error('Missing required escrow configuration in payment requirements');
    }

    // Normalize addresses
    const escrowContract = getAddress(extra.escrowContract);
    const facilitator = getAddress(extra.facilitator);
    const tokenCollector = getAddress(extra.tokenCollector);
    const receiver = getAddress(paymentRequirements.payTo);
    const token = getAddress(paymentRequirements.asset);

    // Compute session parameters
    const now = Math.floor(Date.now() / 1000);
    const salt = this.generateSalt();
    const authorizationExpiry = now + this.sessionDuration;
    const refundExpiry = authorizationExpiry + this.refundWindow;

    // Determine deposit amount with validation
    const minDeposit = extra.minDeposit
      ? BigInt(extra.minDeposit)
      : BigInt(paymentRequirements.amount);
    const maxDeposit = extra.maxDeposit ? BigInt(extra.maxDeposit) : minDeposit;

    let amount: bigint;
    if (this.customDepositAmount !== undefined) {
      // User specified custom deposit - validate against bounds
      if (this.customDepositAmount < minDeposit) {
        throw new Error(
          `Deposit amount ${this.customDepositAmount} is below minimum ${minDeposit}`
        );
      }
      if (this.customDepositAmount > maxDeposit) {
        throw new Error(`Deposit amount ${this.customDepositAmount} exceeds maximum ${maxDeposit}`);
      }
      amount = this.customDepositAmount;
    } else {
      // Default to maxDeposit for maximum flexibility
      amount = maxDeposit;
    }

    const validAfter = 0n;
    const validBefore = BigInt(authorizationExpiry);

    // Compute nonce (payer-agnostic)
    const nonce = computeEscrowNonce(this.chainId, escrowContract, {
      operator: facilitator,
      payer: this.address,
      receiver,
      token,
      maxAmount: amount,
      preApprovalExpiry: authorizationExpiry,
      authorizationExpiry,
      refundExpiry,
      minFeeBps: 0,
      maxFeeBps: 0,
      feeReceiver: ZERO_ADDRESS,
      salt: BigInt(salt),
    });

    // Sign ERC-3009 authorization
    const domain: EIP712Domain = {
      name: extra.name,
      version: extra.version,
      chainId: this.chainId,
      verifyingContract: token,
    };

    const signature = await signERC3009(
      this.wallet,
      { from: this.address, to: tokenCollector, value: amount, validAfter, validBefore, nonce },
      domain
    );

    // Build payload
    const payload: Record<string, unknown> = {
      signature,
      authorization: {
        from: this.address,
        to: tokenCollector,
        value: amount.toString(),
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce,
      },
      sessionParams: {
        salt,
        authorizationExpiry,
        refundExpiry,
      },
    };

    // Only add requestId for escrow scheme (not exact-escrow)
    if (paymentRequirements.scheme === 'escrow') {
      payload.requestId = generateRequestId();
    }

    // Build accepted block for server routing
    const accepted = {
      scheme: paymentRequirements.scheme,
      network: paymentRequirements.network,
      asset: paymentRequirements.asset,
      amount: paymentRequirements.amount,
      payTo: paymentRequirements.payTo,
      maxTimeoutSeconds: paymentRequirements.maxTimeoutSeconds,
      extra: { ...paymentRequirements.extra, facilitator, escrowContract, tokenCollector },
    };

    return { x402Version, accepted, payload } as Pick<PaymentPayload, 'x402Version' | 'payload'>;
  }

  private generateSalt(): Hex {
    return toHex(generateRandomBytes(32));
  }
}
