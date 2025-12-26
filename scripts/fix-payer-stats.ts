/**
 * Fix get_payer_stats RPC function
 *
 * Run with: npx tsx scripts/fix-payer-stats.ts
 *
 * Make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY
 * point to your production Supabase instance.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const migration = `
-- Drop existing function
DROP FUNCTION IF EXISTS get_payer_stats(TEXT);

-- Recreate with correct logic (excludes voided sessions from available)
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
    COALESCE(
      SUM(
        CASE
          WHEN s.status = 'active' THEN sb.available_amount
          ELSE 0
        END
      ),
      0
    )::TEXT as total_available,
    COUNT(*) FILTER (WHERE s.status = 'active' AND s.authorization_expiry > NOW()) as active_sessions,
    COUNT(*) as total_sessions
  FROM sessions s
  JOIN session_balances sb ON sb.session_id = s.id
  WHERE s.payer = lower(p_payer);
END;
$$ LANGUAGE plpgsql;
`;

async function run() {
  console.log('Running migration to fix get_payer_stats...');
  console.log('Supabase URL:', SUPABASE_URL);

  const { error } = await supabase.rpc('exec_sql', { sql: migration });

  if (error) {
    // exec_sql might not exist, try direct query
    console.log('exec_sql not available, trying direct approach...');

    // Split into separate statements
    const _statements = [
      'DROP FUNCTION IF EXISTS get_payer_stats(TEXT)',
      `CREATE OR REPLACE FUNCTION get_payer_stats(
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
          COALESCE(
            SUM(
              CASE
                WHEN s.status = 'active' THEN sb.available_amount
                ELSE 0
              END
            ),
            0
          )::TEXT as total_available,
          COUNT(*) FILTER (WHERE s.status = 'active' AND s.authorization_expiry > NOW()) as active_sessions,
          COUNT(*) as total_sessions
        FROM sessions s
        JOIN session_balances sb ON sb.session_id = s.id
        WHERE s.payer = lower(p_payer);
      END;
      $$ LANGUAGE plpgsql`,
    ];

    console.error('Cannot run raw SQL via Supabase JS client.');
    console.error('Please run this SQL in Supabase Dashboard > SQL Editor:');
    console.error('\n' + migration);
    process.exit(1);
  }

  console.log('Migration completed successfully!');
}

run().catch(console.error);
