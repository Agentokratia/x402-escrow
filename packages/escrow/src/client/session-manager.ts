/**
 * Session Manager for x402 Escrow Scheme
 *
 * Handles session lifecycle: lookup, storage, and validation.
 * Uses the SessionStorage interface for persistence.
 */

import type { Address } from 'viem';
import type { Network } from '../types';
import {
  createStorage,
  type SessionStorage,
  type StoredSession,
  type SessionStatus,
} from './storage';

// Re-export for convenience
export type { StoredSession, SessionStatus } from './storage';

export interface SessionManagerOptions {
  /** Storage type: 'memory' (default) or 'localStorage' */
  storage?: 'memory' | 'localStorage';
  /** localStorage key (default: 'x402-sessions') */
  storageKey?: string;
}

/**
 * Manages session lifecycle for the escrow scheme.
 *
 * Responsibilities:
 * - Store sessions from escrow settlement responses
 * - Find best session for a receiver/amount
 * - Update session balances after debits
 * - Validate session expiry
 */
export class SessionManager {
  private readonly storage: SessionStorage;
  private readonly network: Network;

  constructor(network: Network, options: SessionManagerOptions = {}) {
    this.network = network;
    this.storage = createStorage(options.storage ?? 'memory', options.storageKey);
  }

  /**
   * Store a session from escrow settlement response.
   */
  store(session: Omit<StoredSession, 'createdAt' | 'status'>): void {
    this.storage.set({ ...session, createdAt: Date.now(), status: 'active' });
  }

  /**
   * Update session status (e.g., mark as inactive when reclaimed).
   */
  setStatus(sessionId: string, status: SessionStatus): void {
    const session = this.storage.list().find((s) => s.sessionId === sessionId);
    if (session) {
      this.storage.set({ ...session, status });
    }
  }

  /**
   * Get session for a specific receiver.
   */
  getForReceiver(receiver: Address): StoredSession | null {
    return this.storage.get(this.network, receiver);
  }

  /**
   * Find best session for receiver with minimum balance.
   */
  findBest(receiver: Address, minAmount: bigint): StoredSession | null {
    return this.storage.findBest(this.network, receiver, minAmount);
  }

  /**
   * Check if valid session exists for receiver.
   */
  hasValid(receiver: Address, minAmount?: string): boolean {
    const session = minAmount
      ? this.storage.findBest(this.network, receiver, BigInt(minAmount))
      : this.storage.get(this.network, receiver);
    return session !== null;
  }

  /**
   * Update session balance after debit.
   */
  updateBalance(sessionId: string, newBalance: string): void {
    this.storage.update(sessionId, newBalance);
  }

  /**
   * Get all stored sessions.
   */
  getAll(): StoredSession[] {
    return this.storage.list();
  }

  /**
   * Get all active sessions for a specific receiver.
   */
  getAllForReceiver(receiver: Address): StoredSession[] {
    const now = Date.now() / 1000;
    return this.storage
      .list()
      .filter(
        (s) =>
          s.network === this.network &&
          s.receiver.toLowerCase() === receiver.toLowerCase() &&
          s.authorizationExpiry > now &&
          s.status === 'active'
      );
  }

  /**
   * Get session by ID.
   */
  getById(sessionId: string): StoredSession | null {
    return this.storage.list().find((s) => s.sessionId === sessionId) || null;
  }

  /**
   * Remove a specific session.
   */
  remove(sessionId: string): void {
    this.storage.remove(sessionId);
  }

  /**
   * Clear all sessions.
   */
  clear(): void {
    for (const session of this.storage.list()) {
      this.storage.remove(session.sessionId);
    }
  }
}
