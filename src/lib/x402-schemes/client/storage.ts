/**
 * Session Storage for x402 Escrow Scheme
 *
 * Provides session persistence with two implementations:
 * - InMemoryStorage: For server-side or ephemeral usage
 * - LocalStorage: For browser persistence across page loads
 */

import type { Address } from 'viem';

// ============================================================================
// Types
// ============================================================================

export interface StoredSession {
  sessionId: string;
  sessionToken: string;
  network: string;
  payer: Address;
  receiver: Address;
  balance: string;
  authorizationExpiry: number;
  createdAt: number;
}

export interface SessionStorage {
  get(network: string, receiver: Address): StoredSession | null;
  findBest(network: string, receiver: Address, minAmount: bigint): StoredSession | null;
  set(session: StoredSession): void;
  update(sessionId: string, balance: string): void;
  list(): StoredSession[];
  remove(sessionId: string): void;
}

// ============================================================================
// Base Storage (shared logic)
// ============================================================================

abstract class BaseStorage implements SessionStorage {
  protected sessions = new Map<string, StoredSession>();

  get(network: string, receiver: Address): StoredSession | null {
    const now = Date.now() / 1000;
    for (const session of this.sessions.values()) {
      if (
        session.network === network &&
        session.receiver.toLowerCase() === receiver.toLowerCase() &&
        session.authorizationExpiry > now
      ) {
        return session;
      }
    }
    return null;
  }

  findBest(network: string, receiver: Address, minAmount: bigint): StoredSession | null {
    const now = Date.now() / 1000;
    let best: StoredSession | null = null;
    let bestBalance = 0n;

    for (const session of this.sessions.values()) {
      if (
        session.network === network &&
        session.receiver.toLowerCase() === receiver.toLowerCase() &&
        session.authorizationExpiry > now
      ) {
        const balance = BigInt(session.balance);
        if (balance >= minAmount && balance > bestBalance) {
          best = session;
          bestBalance = balance;
        }
      }
    }
    return best;
  }

  set(session: StoredSession): void {
    this.sessions.set(session.sessionId, session);
    this.onUpdate();
  }

  update(sessionId: string, balance: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.set(sessionId, { ...session, balance });
      this.onUpdate();
    }
  }

  list(): StoredSession[] {
    return Array.from(this.sessions.values());
  }

  remove(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.onUpdate();
  }

  /** Override in subclasses for persistence */
  protected onUpdate(): void {}
}

// ============================================================================
// In-Memory Storage
// ============================================================================

export class InMemoryStorage extends BaseStorage {
  // No persistence needed
}

// ============================================================================
// LocalStorage (Browser)
// ============================================================================

export class BrowserLocalStorage extends BaseStorage {
  private key: string;

  constructor(key = 'x402-sessions') {
    super();
    this.key = key;
    this.load();
  }

  protected override onUpdate(): void {
    this.save();
  }

  private load(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const data = localStorage.getItem(this.key);
      if (data) {
        const sessions: StoredSession[] = JSON.parse(data);
        for (const s of sessions) this.sessions.set(s.sessionId, s);
      }
    } catch {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[x402] Failed to load sessions from localStorage');
      }
    }
  }

  private save(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.key, JSON.stringify(Array.from(this.sessions.values())));
    } catch {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[x402] Failed to save sessions to localStorage');
      }
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createStorage(
  type: 'memory' | 'localStorage',
  storageKey?: string
): SessionStorage {
  return type === 'localStorage' ? new BrowserLocalStorage(storageKey) : new InMemoryStorage();
}
