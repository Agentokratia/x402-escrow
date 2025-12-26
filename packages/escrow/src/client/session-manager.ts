/**
 * Session Manager for x402 Escrow Scheme
 *
 * Handles session lifecycle: lookup, storage, and validation.
 * Uses the SessionStorage interface for persistence.
 */

import type { Address } from 'viem';
import type { Network } from '../types';
import { createStorage, type SessionStorage, type StoredSession } from './storage';

// Re-export for convenience
export type { StoredSession } from './storage';

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
  store(session: Omit<StoredSession, 'createdAt'>): void {
    this.storage.set({ ...session, createdAt: Date.now() });
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
