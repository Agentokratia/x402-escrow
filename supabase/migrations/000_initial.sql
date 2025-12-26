-- x402 Escrow Facilitator Schema
-- Complete schema for fresh database setup

-- ============================================================================
-- NETWORKS TABLE
-- ============================================================================

CREATE TABLE networks (
  id TEXT PRIMARY KEY, -- CAIP-2 format: "eip155:{chainId}"
  name TEXT NOT NULL,
  chain_id INTEGER UNIQUE NOT NULL,
  rpc_url TEXT NOT NULL,
  -- Contract addresses (lowercase Ethereum addresses)
  escrow_contract TEXT NOT NULL CHECK (escrow_contract = lower(escrow_contract)),
  usdc_address TEXT NOT NULL CHECK (usdc_address = lower(usdc_address)),
  multicall3_address TEXT NOT NULL DEFAULT '0xca11bde05977b3631167028862be2a173976ca11' CHECK (multicall3_address = lower(multicall3_address)),
  erc3009_collector TEXT CHECK (erc3009_collector IS NULL OR erc3009_collector = lower(erc3009_collector)),
  permit2_collector TEXT CHECK (permit2_collector IS NULL OR permit2_collector = lower(permit2_collector)),
  pre_approval_collector TEXT CHECK (pre_approval_collector IS NULL OR pre_approval_collector = lower(pre_approval_collector)),
  spend_permission_collector TEXT CHECK (spend_permission_collector IS NULL OR spend_permission_collector = lower(spend_permission_collector)),
  block_explorer_url TEXT,
  is_testnet BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  block_confirmations INTEGER DEFAULT 1,
  -- EIP-712 domain fields for USDC token (varies by chain)
  usdc_eip712_name TEXT DEFAULT 'USD Coin',
  usdc_eip712_version TEXT DEFAULT '2',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  -- CAIP-2 format validation: id must be "eip155:{chain_id}"
  CONSTRAINT caip2_format CHECK (id = 'eip155:' || chain_id::text)
);

-- Seed default networks (CAIP-2 format IDs, lowercase addresses)
INSERT INTO networks (
  id, name, chain_id, rpc_url, escrow_contract, usdc_address, multicall3_address,
  erc3009_collector, permit2_collector, block_explorer_url, is_testnet, is_active,
  usdc_eip712_name, usdc_eip712_version
) VALUES
  ('eip155:8453', 'Base Mainnet', 8453, 'https://mainnet.base.org',
   '0xbdea0d1bcc5966192b070fdf62ab4ef5b4420cff', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
   '0xca11bde05977b3631167028862be2a173976ca11', '0x0e3df9510de65469c4518d7843919c0b8c7a7757',
   '0x992476b9ee81d52a5bda0622c333938d0af0ab26', 'https://basescan.org',
   false, true, 'USDC', '2'),
  ('eip155:84532', 'Base Sepolia', 84532, 'https://sepolia.base.org',
   '0xbdea0d1bcc5966192b070fdf62ab4ef5b4420cff', '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
   '0xca11bde05977b3631167028862be2a173976ca11', '0x0e3df9510de65469c4518d7843919c0b8c7a7757',
   '0x992476b9ee81d52a5bda0622c333938d0af0ab26', 'https://sepolia.basescan.org',
   true, true, 'USD Coin', '2');

-- ============================================================================
-- USERS TABLE (one per wallet)
-- ============================================================================

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet TEXT UNIQUE NOT NULL CHECK (wallet = lower(wallet)), -- Enforce lowercase
  name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- AUTH NONCES TABLE (for SIWE login)
-- ============================================================================

CREATE TABLE auth_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce TEXT UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  wallet TEXT CHECK (wallet IS NULL OR wallet = lower(wallet)),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_auth_nonces_nonce ON auth_nonces(nonce) WHERE used_at IS NULL;

-- ============================================================================
-- API KEYS TABLE (multiple per user)
-- ============================================================================

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  api_key_hash TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_hash ON api_keys(api_key_hash);
CREATE INDEX idx_api_keys_user ON api_keys(user_id);

-- ============================================================================
-- SESSIONS TABLE (on-chain escrow sessions)
-- ============================================================================

CREATE TABLE sessions (
  id TEXT PRIMARY KEY, -- paymentInfoHash from escrow contract
  network_id TEXT REFERENCES networks(id) ON DELETE RESTRICT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE RESTRICT NOT NULL,

  -- Parties (lowercase Ethereum addresses)
  payer TEXT NOT NULL CHECK (payer = lower(payer)),
  receiver TEXT NOT NULL CHECK (receiver = lower(receiver)),
  token TEXT NOT NULL CHECK (token = lower(token)),

  -- Balance tracking (in token units, e.g., USDC with 6 decimals)
  -- Note: captured_amount and pending_amount are DEPRECATED - use session_balances view
  authorized_amount NUMERIC NOT NULL CHECK (authorized_amount > 0),
  captured_amount NUMERIC DEFAULT 0 CHECK (captured_amount >= 0),  -- DEPRECATED: kept for backward compat
  pending_amount NUMERIC DEFAULT 0 CHECK (pending_amount >= 0),    -- DEPRECATED: kept for backward compat

  -- Expiry timestamps
  authorization_expiry TIMESTAMPTZ NOT NULL,
  refund_expiry TIMESTAMPTZ NOT NULL,

  -- PaymentInfo fields required for capture/void contract calls
  operator TEXT NOT NULL CHECK (operator = lower(operator)),
  salt TEXT NOT NULL,
  pre_approval_expiry TIMESTAMPTZ NOT NULL,
  min_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (min_fee_bps >= 0 AND min_fee_bps <= 10000),
  max_fee_bps INTEGER NOT NULL DEFAULT 0 CHECK (max_fee_bps >= 0 AND max_fee_bps <= 10000),
  fee_receiver TEXT NOT NULL DEFAULT '0x0000000000000000000000000000000000000000' CHECK (fee_receiver = lower(fee_receiver)),

  -- Session lifecycle
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'voided', 'expired', 'captured')),
  authorize_tx_hash TEXT, -- Stored when session is authorized
  void_tx_hash TEXT, -- Stored when session is voided
  session_token_hash TEXT, -- Session token for API access (shown once, stored as hash)
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Critical invariants (balance_invariant removed - now enforced via logs)
  CONSTRAINT fee_order CHECK (min_fee_bps <= max_fee_bps),
  -- Per Base Commerce: operator capture window ends before payer can reclaim
  CONSTRAINT expiry_order CHECK (authorization_expiry <= refund_expiry)
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_user_status ON sessions(user_id, status);
CREATE INDEX idx_sessions_payer ON sessions(payer);
CREATE INDEX idx_sessions_payer_status ON sessions(payer, status);
-- Note: idx_sessions_pending removed - was using deprecated pending_amount column
-- Use session_balances view instead for pending balance queries
CREATE INDEX idx_sessions_expiry ON sessions(authorization_expiry) WHERE status = 'active';
CREATE INDEX idx_sessions_token_hash ON sessions(session_token_hash) WHERE session_token_hash IS NOT NULL;

-- ============================================================================
-- CAPTURE LOGS TABLE (tracks on-chain captures)
-- ============================================================================

CREATE TABLE capture_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  network_id TEXT REFERENCES networks(id) ON DELETE RESTRICT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0), -- Must be positive
  tx_hash TEXT, -- Required for confirmed status (enforced by app, not DB for flexibility)
  tier INTEGER NOT NULL CHECK (tier IN (1, 2, 3)),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_capture_session ON capture_logs(session_id);
CREATE INDEX idx_capture_pending ON capture_logs(status) WHERE status = 'pending';

-- ============================================================================
-- USAGE LOGS TABLE (tracks individual debits - source of truth for balance)
-- ============================================================================

CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE NOT NULL,
  request_id TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0), -- Must be positive
  description TEXT,
  -- Log-based balance tracking
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'settled')),
  capture_log_id UUID REFERENCES capture_logs(id),  -- Which capture settled this usage
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  -- Idempotency: request_id unique PER SESSION (not globally)
  UNIQUE(session_id, request_id)
);

CREATE INDEX idx_usage_session ON usage_logs(session_id);
CREATE INDEX idx_usage_pending ON usage_logs(session_id, status) WHERE status = 'pending';
-- Composite index for efficient balance aggregation in session_balances view
CREATE INDEX idx_usage_balance ON usage_logs(session_id, status, amount);

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Session balances computed from usage_logs (source of truth)
CREATE OR REPLACE VIEW session_balances AS
SELECT
  s.id AS session_id,
  s.authorized_amount,
  COALESCE(SUM(CASE WHEN ul.status = 'settled' THEN ul.amount ELSE 0 END), 0) AS captured_amount,
  COALESCE(SUM(CASE WHEN ul.status = 'pending' THEN ul.amount ELSE 0 END), 0) AS pending_amount,
  s.authorized_amount - COALESCE(SUM(ul.amount), 0) AS available_amount
FROM sessions s
LEFT JOIN usage_logs ul ON ul.session_id = s.id
GROUP BY s.id, s.authorized_amount;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Check and update session expiry status
CREATE OR REPLACE FUNCTION check_session_expiry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.authorization_expiry < NOW() AND NEW.status = 'active' THEN
    NEW.status := 'expired';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Atomic session debit with row locking (log-based balance)
CREATE OR REPLACE FUNCTION debit_session(
  p_session_id TEXT,
  p_amount NUMERIC,
  p_request_id TEXT,
  p_description TEXT DEFAULT NULL
) RETURNS TABLE (
  success BOOLEAN,
  is_idempotent BOOLEAN,
  error_code TEXT,
  authorized NUMERIC,
  captured NUMERIC,
  pending NUMERIC,
  available NUMERIC
) AS $$
DECLARE
  v_session RECORD;
  v_balance RECORD;
BEGIN
  -- Lock the session row for update
  SELECT * INTO v_session
  FROM sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, FALSE, 'SESSION_NOT_FOUND'::TEXT, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
    RETURN;
  END IF;

  IF v_session.status != 'active' THEN
    -- Get current balance from logs
    SELECT * INTO v_balance FROM session_balances WHERE session_id = p_session_id;
    RETURN QUERY SELECT FALSE, FALSE, 'SESSION_INACTIVE'::TEXT,
      v_balance.authorized_amount, v_balance.captured_amount, v_balance.pending_amount, v_balance.available_amount;
    RETURN;
  END IF;

  IF v_session.authorization_expiry < NOW() THEN
    SELECT * INTO v_balance FROM session_balances WHERE session_id = p_session_id;
    RETURN QUERY SELECT FALSE, FALSE, 'SESSION_EXPIRED'::TEXT,
      v_balance.authorized_amount, v_balance.captured_amount, v_balance.pending_amount, 0::NUMERIC;
    RETURN;
  END IF;

  -- CRITICAL: Lock all usage_logs for this session to prevent concurrent inserts
  -- This prevents race conditions where two debits both pass the balance check
  PERFORM 1 FROM usage_logs WHERE session_id = p_session_id FOR UPDATE;

  -- Idempotency: if request already processed, return success with current balance
  IF EXISTS (SELECT 1 FROM usage_logs WHERE session_id = p_session_id AND request_id = p_request_id) THEN
    SELECT * INTO v_balance FROM session_balances WHERE session_id = p_session_id;
    RETURN QUERY SELECT TRUE, TRUE, NULL::TEXT,
      v_balance.authorized_amount, v_balance.captured_amount, v_balance.pending_amount, v_balance.available_amount;
    RETURN;
  END IF;

  -- Calculate available from logs (safe now that we have the lock)
  SELECT * INTO v_balance FROM session_balances WHERE session_id = p_session_id;

  IF p_amount > v_balance.available_amount THEN
    RETURN QUERY SELECT FALSE, FALSE, 'INSUFFICIENT_BALANCE'::TEXT,
      v_balance.authorized_amount, v_balance.captured_amount, v_balance.pending_amount, v_balance.available_amount;
    RETURN;
  END IF;

  -- Insert usage log (no counter update needed - balance computed from logs)
  INSERT INTO usage_logs (session_id, request_id, amount, description, status)
  VALUES (p_session_id, p_request_id, p_amount, p_description, 'pending');

  -- Return updated balance
  SELECT * INTO v_balance FROM session_balances WHERE session_id = p_session_id;

  RETURN QUERY SELECT TRUE, FALSE, NULL::TEXT,
    v_balance.authorized_amount, v_balance.captured_amount, v_balance.pending_amount, v_balance.available_amount;
END;
$$ LANGUAGE plpgsql;

-- Sync capture for TIER 3 captures (marks usage_logs as settled)
CREATE OR REPLACE FUNCTION sync_capture(
  p_session_id TEXT,
  p_amount NUMERIC,
  p_tx_hash TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_session RECORD;
  v_capture_log_id UUID;
  v_remaining NUMERIC;
  v_usage RECORD;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND OR v_session.status != 'active' THEN
    RETURN;
  END IF;

  -- Create capture log
  INSERT INTO capture_logs (session_id, network_id, amount, tx_hash, tier, status)
  VALUES (p_session_id, v_session.network_id, p_amount, p_tx_hash, 3, 'confirmed')
  RETURNING id INTO v_capture_log_id;

  -- Mark pending usage_logs as settled (FIFO order, with row locking)
  v_remaining := p_amount;
  FOR v_usage IN
    SELECT id, amount FROM usage_logs
    WHERE session_id = p_session_id AND status = 'pending'
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    IF v_remaining <= 0 THEN
      EXIT;
    END IF;

    UPDATE usage_logs
    SET status = 'settled', capture_log_id = v_capture_log_id, settled_at = NOW()
    WHERE id = v_usage.id;

    v_remaining := v_remaining - v_usage.amount;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Atomic void session (log-based balance)
CREATE OR REPLACE FUNCTION void_session(
  p_session_id TEXT,
  p_capture_tx_hash TEXT DEFAULT NULL,
  p_void_tx_hash TEXT DEFAULT NULL
) RETURNS TABLE (
  success BOOLEAN,
  error_message TEXT,
  authorized NUMERIC,
  captured NUMERIC,
  pending_captured NUMERIC,
  voided_amount NUMERIC
) AS $$
DECLARE
  v_session RECORD;
  v_balance RECORD;
  v_pending NUMERIC;
  v_capture_log_id UUID;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Session not found'::TEXT, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
    RETURN;
  END IF;

  IF v_session.status != 'active' THEN
    RETURN QUERY SELECT FALSE, ('Session is already ' || v_session.status)::TEXT,
      v_session.authorized_amount, 0::NUMERIC, 0::NUMERIC, 0::NUMERIC;
    RETURN;
  END IF;

  -- Get current balance from logs
  SELECT * INTO v_balance FROM session_balances WHERE session_id = p_session_id;
  v_pending := v_balance.pending_amount;

  -- If there's pending, create a capture log and settle usage_logs
  IF v_pending > 0 THEN
    INSERT INTO capture_logs (session_id, network_id, amount, tx_hash, tier, status)
    VALUES (p_session_id, v_session.network_id, v_pending, p_capture_tx_hash, 3, 'confirmed')
    RETURNING id INTO v_capture_log_id;

    -- Mark all pending usage_logs as settled (with row locking)
    UPDATE usage_logs
    SET status = 'settled', capture_log_id = v_capture_log_id, settled_at = NOW()
    WHERE id IN (
      SELECT id FROM usage_logs
      WHERE session_id = p_session_id AND status = 'pending'
      FOR UPDATE
    );
  END IF;

  -- Update session status
  UPDATE sessions
  SET status = 'voided', void_tx_hash = p_void_tx_hash
  WHERE id = p_session_id;

  RETURN QUERY SELECT TRUE, NULL::TEXT,
    v_balance.authorized_amount,
    v_balance.captured_amount + v_pending,
    v_pending,
    v_balance.available_amount;
END;
$$ LANGUAGE plpgsql;

-- Atomic batch capture for TIER 1 and TIER 2 (log-based balance)
CREATE OR REPLACE FUNCTION batch_capture(
  p_session_id TEXT,
  p_tx_hash TEXT DEFAULT NULL,
  p_tier INTEGER DEFAULT 1
) RETURNS TABLE (
  success BOOLEAN,
  error_message TEXT,
  captured_amount NUMERIC
) AS $$
DECLARE
  v_session RECORD;
  v_balance RECORD;
  v_pending NUMERIC;
  v_capture_log_id UUID;
BEGIN
  SELECT * INTO v_session FROM sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT FALSE, 'Session not found'::TEXT, 0::NUMERIC;
    RETURN;
  END IF;

  IF v_session.status != 'active' THEN
    RETURN QUERY SELECT FALSE, ('Session is ' || v_session.status)::TEXT, 0::NUMERIC;
    RETURN;
  END IF;

  -- Get pending from logs
  SELECT * INTO v_balance FROM session_balances WHERE session_id = p_session_id;
  v_pending := v_balance.pending_amount;

  IF v_pending <= 0 THEN
    RETURN QUERY SELECT TRUE, 'No pending amount'::TEXT, 0::NUMERIC;
    RETURN;
  END IF;

  -- Create capture log
  INSERT INTO capture_logs (session_id, network_id, amount, tx_hash, tier, status)
  VALUES (p_session_id, v_session.network_id, v_pending, p_tx_hash, p_tier, 'confirmed')
  RETURNING id INTO v_capture_log_id;

  -- Mark all pending usage_logs as settled (with row locking)
  UPDATE usage_logs
  SET status = 'settled', capture_log_id = v_capture_log_id, settled_at = NOW()
  WHERE id IN (
    SELECT id FROM usage_logs
    WHERE session_id = p_session_id AND status = 'pending'
    FOR UPDATE
  );

  RETURN QUERY SELECT TRUE, NULL::TEXT, v_pending;
END;
$$ LANGUAGE plpgsql;

-- Cleanup expired/used nonces (call periodically via cron or on-demand)
CREATE OR REPLACE FUNCTION cleanup_auth_nonces()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Delete nonces that are either:
  -- 1. Used (used_at IS NOT NULL), or
  -- 2. Expired (expires_at < NOW())
  DELETE FROM auth_nonces
  WHERE used_at IS NOT NULL
     OR expires_at < NOW();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Get sessions needing TIER 1 capture (pending >= threshold)
CREATE OR REPLACE FUNCTION get_sessions_for_capture_tier1(
  p_threshold NUMERIC,
  p_limit INTEGER DEFAULT 50
) RETURNS TABLE (
  id TEXT,
  network_id TEXT,
  payer TEXT,
  receiver TEXT,
  user_id UUID,
  token TEXT,
  authorized_amount NUMERIC,
  authorization_expiry TIMESTAMPTZ,
  refund_expiry TIMESTAMPTZ,
  status TEXT,
  operator TEXT,
  salt TEXT,
  pre_approval_expiry TIMESTAMPTZ,
  min_fee_bps INTEGER,
  max_fee_bps INTEGER,
  fee_receiver TEXT,
  pending_from_logs NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.network_id, s.payer, s.receiver, s.user_id, s.token,
    s.authorized_amount, s.authorization_expiry, s.refund_expiry, s.status,
    s.operator, s.salt, s.pre_approval_expiry, s.min_fee_bps, s.max_fee_bps, s.fee_receiver,
    sb.pending_amount
  FROM sessions s
  JOIN session_balances sb ON sb.session_id = s.id
  WHERE s.status = 'active'
    AND sb.pending_amount >= p_threshold
  ORDER BY sb.pending_amount DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Get sessions needing TIER 2 capture (expiring soon with pending > 0)
CREATE OR REPLACE FUNCTION get_sessions_for_capture_tier2(
  p_expiry_before TIMESTAMPTZ,
  p_limit INTEGER DEFAULT 50
) RETURNS TABLE (
  id TEXT,
  network_id TEXT,
  payer TEXT,
  receiver TEXT,
  user_id UUID,
  token TEXT,
  authorized_amount NUMERIC,
  authorization_expiry TIMESTAMPTZ,
  refund_expiry TIMESTAMPTZ,
  status TEXT,
  operator TEXT,
  salt TEXT,
  pre_approval_expiry TIMESTAMPTZ,
  min_fee_bps INTEGER,
  max_fee_bps INTEGER,
  fee_receiver TEXT,
  pending_from_logs NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.id, s.network_id, s.payer, s.receiver, s.user_id, s.token,
    s.authorized_amount, s.authorization_expiry, s.refund_expiry, s.status,
    s.operator, s.salt, s.pre_approval_expiry, s.min_fee_bps, s.max_fee_bps, s.fee_receiver,
    sb.pending_amount
  FROM sessions s
  JOIN session_balances sb ON sb.session_id = s.id
  WHERE s.status = 'active'
    AND sb.pending_amount > 0
    AND s.authorization_expiry <= p_expiry_before
  ORDER BY s.authorization_expiry ASC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Get aggregate stats for a payer wallet (log-based balance)
-- Only counts available for non-voided sessions (active or expired can be reclaimed)
CREATE OR REPLACE FUNCTION get_payer_stats(
  p_payer TEXT
) RETURNS TABLE (
  total_authorized TEXT,
  total_captured TEXT,
  total_pending TEXT,
  total_available TEXT,
  active_sessions BIGINT,
  total_sessions BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(sb.authorized_amount), 0)::TEXT as total_authorized,
    COALESCE(SUM(sb.captured_amount), 0)::TEXT as total_captured,
    COALESCE(SUM(sb.pending_amount), 0)::TEXT as total_pending,
    -- Only count available for non-voided sessions (active or expired can be reclaimed)
    COALESCE(
      SUM(
        CASE
          WHEN s.status = 'active' THEN sb.available_amount
          ELSE 0
        END
      ),
      0
    )::TEXT as total_available,
    -- Active sessions = status='active' AND not expired
    COUNT(*) FILTER (WHERE s.status = 'active' AND s.authorization_expiry > NOW()) as active_sessions,
    COUNT(*) as total_sessions
  FROM sessions s
  JOIN session_balances sb ON sb.session_id = s.id
  WHERE s.payer = lower(p_payer);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- TRIGGERS
-- ============================================================================

CREATE TRIGGER networks_updated_at
  BEFORE UPDATE ON networks
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER session_expiry_check
  BEFORE UPDATE ON sessions
  FOR EACH ROW
  EXECUTE FUNCTION check_session_expiry();
