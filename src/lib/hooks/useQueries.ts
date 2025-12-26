'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchWithAuth } from '@/lib/store/authStore';
import type { SessionData } from '@/components/session';

// Types
interface StatusDistribution {
  active: number;
  captured: number;
  voided: number;
  expired: number;
}

interface RecentSession {
  id: string;
  payer: string;
  amount: string;
  status: string;
  createdAt: string;
}

export interface OperatorStats {
  activeSessions: number;
  totalCaptured: string;
  pendingAmount: string;
  apiKeys: number;
  statusDistribution: StatusDistribution;
  totalSessions: number;
  recentSessions: RecentSession[];
}

export interface PayerStats {
  totalAuthorized: string;
  totalAvailable: string;
  activeSessions: number;
}

interface SessionBalance {
  authorized: string;
  captured: string;
  pending: string;
  available: string;
}

export interface Session {
  id: string;
  networkId: string;
  networkName: string;
  payer: string;
  receiver: string;
  balance: SessionBalance;
  status: string;
  authorizationExpiry: number;
  createdAt: string;
}

export interface ReclaimableData {
  sessions: Session[];
  totalAvailable: string;
  count: number;
}

export type FilterStatus = 'all' | 'active' | 'captured' | 'voided' | 'expired';

// Query Keys
export const queryKeys = {
  operatorStats: ['operatorStats'] as const,
  payerStats: ['payerStats'] as const,
  operatorSessions: (filter: FilterStatus) => ['operatorSessions', filter] as const,
  payerSessions: (filter: FilterStatus) => ['payerSessions', filter] as const,
  reclaimable: ['reclaimable'] as const,
  session: (id: string) => ['session', id] as const,
  payerSession: (id: string) => ['payerSession', id] as const,
  apiKeys: ['apiKeys'] as const,
};

// Operator Stats
export function useOperatorStats() {
  return useQuery({
    queryKey: queryKeys.operatorStats,
    queryFn: async () => {
      const response = await fetchWithAuth('/api/stats');
      if (!response.ok) throw new Error('Failed to fetch operator stats');
      return response.json() as Promise<OperatorStats>;
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

// Payer Stats
export function usePayerStats() {
  return useQuery({
    queryKey: queryKeys.payerStats,
    queryFn: async () => {
      const response = await fetchWithAuth('/api/payer/stats');
      if (!response.ok) throw new Error('Failed to fetch payer stats');
      return response.json() as Promise<PayerStats>;
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

// Combined dashboard stats
export function useDashboardStats() {
  const operatorQuery = useOperatorStats();
  const payerQuery = usePayerStats();

  return {
    operatorStats: operatorQuery.data,
    payerStats: payerQuery.data,
    isLoading: operatorQuery.isLoading || payerQuery.isLoading,
    isError: operatorQuery.isError || payerQuery.isError,
    error: operatorQuery.error || payerQuery.error,
  };
}

// Operator Sessions List
export function useOperatorSessions(filter: FilterStatus = 'all') {
  return useQuery({
    queryKey: queryKeys.operatorSessions(filter),
    queryFn: async () => {
      const statusParam = filter === 'all' ? '' : `?status=${filter}`;
      const response = await fetchWithAuth(`/api/sessions${statusParam}`);
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const data = await response.json();
      return data.sessions as Session[];
    },
    staleTime: 1000 * 30, // 30 seconds
  });
}

// Payer Sessions List
export function usePayerSessions(filter: FilterStatus = 'all') {
  return useQuery({
    queryKey: queryKeys.payerSessions(filter),
    queryFn: async () => {
      const statusParam = filter === 'all' ? '' : `?status=${filter}`;
      const response = await fetchWithAuth(`/api/payer/sessions${statusParam}`);
      if (!response.ok) throw new Error('Failed to fetch sessions');
      const data = await response.json();
      return data.sessions as Session[];
    },
    staleTime: 1000 * 30, // 30 seconds
  });
}

// Reclaimable Sessions
export function useReclaimable() {
  return useQuery({
    queryKey: queryKeys.reclaimable,
    queryFn: async () => {
      const response = await fetchWithAuth('/api/payer/sessions/reclaimable');
      if (!response.ok) throw new Error('Failed to fetch reclaimable');
      return response.json() as Promise<ReclaimableData>;
    },
    staleTime: 1000 * 30, // 30 seconds
  });
}

// Reclaim All Mutation
export function useReclaimAll() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth('/api/payer/sessions/reclaim-all', {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reclaim');
      }
      return response.json();
    },
    onSuccess: () => {
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['payerSessions'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.reclaimable });
      queryClient.invalidateQueries({ queryKey: queryKeys.payerStats });
    },
  });
}

// Reclaim Single Session Mutation
export function useReclaimSession(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth(`/api/payer/sessions/${sessionId}/reclaim`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to reclaim');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payerSessions'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.reclaimable });
      queryClient.invalidateQueries({ queryKey: queryKeys.payerStats });
      queryClient.invalidateQueries({ queryKey: queryKeys.payerSession(sessionId) });
    },
  });
}

// Operator Session Detail
export function useOperatorSessionDetail(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.session(sessionId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/sessions/${sessionId}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Session not found');
        }
        throw new Error('Failed to load session');
      }
      return response.json() as Promise<SessionData>;
    },
    staleTime: 1000 * 30, // 30 seconds
  });
}

// Payer Session Detail
export function usePayerSessionDetail(sessionId: string) {
  return useQuery({
    queryKey: queryKeys.payerSession(sessionId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/payer/sessions/${sessionId}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Session not found');
        }
        throw new Error('Failed to load session');
      }
      return response.json() as Promise<SessionData>;
    },
    staleTime: 1000 * 30, // 30 seconds
  });
}
