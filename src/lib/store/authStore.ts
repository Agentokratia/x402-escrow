'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SiweMessage } from 'siwe';
import { useEffect, useState } from 'react';

interface AuthState {
  token: string | null;
  walletAddress: string | null;
  isAuthenticated: boolean;
  _hasHydrated: boolean;
  setAuth: (token: string, walletAddress: string) => void;
  clearAuth: () => void;
  setHasHydrated: (state: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      walletAddress: null,
      isAuthenticated: false,
      _hasHydrated: false,

      setAuth: (token, walletAddress) => {
        set({
          token,
          walletAddress: walletAddress.toLowerCase(),
          isAuthenticated: true,
        });
      },

      clearAuth: () => {
        set({ token: null, walletAddress: null, isAuthenticated: false });
      },

      setHasHydrated: (state) => {
        set({ _hasHydrated: state });
      },
    }),
    {
      name: 'x402-escrow-auth',
      storage: createJSONStorage(() => localStorage),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

/**
 * Hook to check if the auth store has been hydrated from localStorage.
 * Use this to prevent hydration mismatches in SSR.
 */
export function useAuthHydrated(): boolean {
  const hasHydrated = useAuthStore((state) => state._hasHydrated);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setIsHydrated(hasHydrated);
  }, [hasHydrated]);

  return isHydrated;
}

// SIWE helper - must be called client-side only
export function createSiweMessage(address: string, chainId: number, nonce: string): SiweMessage {
  if (typeof window === 'undefined') {
    throw new Error('createSiweMessage must be called client-side');
  }

  return new SiweMessage({
    domain: window.location.host,
    address,
    statement: 'Sign in to x402 Escrow Facilitator',
    uri: window.location.origin,
    version: '1',
    chainId,
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });
}

// Auth API helpers
export const authApi = {
  async getNonce(): Promise<string> {
    const res = await fetch('/api/auth/nonce');
    if (!res.ok) throw new Error('Failed to get nonce');
    const data = await res.json();
    return data.nonce;
  },

  async verify(message: string, signature: string): Promise<{ token: string; wallet: string }> {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error || 'Verification failed');
    }

    const data = await res.json();
    return {
      token: data.token,
      wallet: data.user.wallet,
    };
  },
};

// Fetch helper with auth - handles 401 by clearing auth and throwing
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const { token, clearAuth } = useAuthStore.getState();

  const headers = new Headers(options.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(url, { ...options, headers });

  // If unauthorized (expired JWT or invalid token), clear auth and redirect
  if (response.status === 401) {
    clearAuth();
    // Redirect to home page for re-authentication
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
    // Throw to prevent caller from processing the response
    throw new Error('Session expired');
  }

  return response;
}
