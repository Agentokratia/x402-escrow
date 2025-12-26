import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || '';

// Admin client for server-side operations (full access)
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Type definitions for database tables

export interface DbNetwork {
  id: string; // CAIP-2 format: "eip155:{chainId}"
  name: string;
  chain_id: number;
  rpc_url: string;
  escrow_contract: string;
  usdc_address: string;
  multicall3_address: string;
  erc3009_collector: string | null;
  permit2_collector: string | null;
  pre_approval_collector: string | null;
  spend_permission_collector: string | null;
  block_explorer_url: string | null;
  is_testnet: boolean;
  is_active: boolean;
  block_confirmations: number;
  cdp_network: string | null; // CDP network identifier (e.g., 'base', 'base-sepolia')
  usdc_eip712_name: string; // EIP-712 domain name for USDC (varies by chain)
  usdc_eip712_version: string; // EIP-712 domain version for USDC
  created_at: string;
  updated_at: string;
}

export interface DbUser {
  id: string;
  wallet: string;
  name: string | null;
  email: string | null;
  created_at: string;
  updated_at: string | null;
}

export type ApiKeyStatus = 'active' | 'revoked';

export interface DbApiKey {
  id: string;
  user_id: string;
  name: string;
  api_key_hash: string;
  status: ApiKeyStatus;
  created_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
}

export type SessionStatus = 'active' | 'voided' | 'expired' | 'captured';

export type UsageLogStatus = 'pending' | 'settled';

export interface DbUsageLog {
  id: string;
  session_id: string;
  request_id: string;
  amount: string;
  description: string | null;
  // Log-based balance tracking
  status: UsageLogStatus;
  capture_log_id: string | null; // Which capture settled this usage
  settled_at: string | null;
  created_at: string;
}

export interface DbCaptureLog {
  id: string;
  session_id: string;
  network_id: string;
  amount: string;
  tx_hash: string | null;
  tier: number;
  status: 'pending' | 'confirmed' | 'failed';
  created_at: string;
}

export interface DbSession {
  id: string; // paymentInfoHash
  network_id: string;
  payer: string;
  receiver: string;
  user_id: string;
  token: string;
  authorized_amount: string;
  // DEPRECATED: use session_balances view instead
  captured_amount: string;
  pending_amount: string;
  authorization_expiry: string;
  refund_expiry: string;
  status: SessionStatus;
  authorize_tx_hash: string | null;
  void_tx_hash: string | null;
  created_at: string;
  // PaymentInfo fields for capture/void
  operator: string;
  salt: string;
  pre_approval_expiry: string;
  min_fee_bps: number;
  max_fee_bps: number;
  fee_receiver: string;
  // Session token hash (for secure session access)
  session_token_hash: string | null;
}

// Balance computed from usage_logs (source of truth)
export interface DbSessionBalance {
  session_id: string;
  authorized_amount: string;
  captured_amount: string;
  pending_amount: string;
  available_amount: string;
}

// Helper to get network config
export async function getNetwork(networkId: string): Promise<DbNetwork | null> {
  const { data, error } = await supabase
    .from('networks')
    .select('*')
    .eq('id', networkId)
    .eq('is_active', true)
    .single<DbNetwork>();

  if (error || !data) {
    console.error('Failed to get network:', error);
    return null;
  }

  return data;
}

// Get session balance from the session_balances view (source of truth)
export async function getSessionBalance(sessionId: string): Promise<DbSessionBalance | null> {
  const { data, error } = await supabase
    .from('session_balances')
    .select('*')
    .eq('session_id', sessionId)
    .single<DbSessionBalance>();

  if (error || !data) {
    console.error('Failed to get session balance:', error);
    return null;
  }

  return data;
}

// Get network from CAIP-2 string (e.g., "eip155:8453")
// Network IDs in DB are CAIP-2 format, so direct lookup works
export async function getNetworkFromString(network: string): Promise<DbNetwork | null> {
  // CAIP-2 format (eip155:8453) - direct lookup
  if (network.startsWith('eip155:')) {
    return getNetwork(network);
  }

  // Numeric chain ID - convert to CAIP-2 and lookup
  const chainId = parseInt(network, 10);
  if (!isNaN(chainId)) {
    return getNetwork(`eip155:${chainId}`);
  }

  return null;
}
