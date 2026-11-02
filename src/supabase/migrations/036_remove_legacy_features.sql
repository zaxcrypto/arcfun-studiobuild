-- ==============================================================================
-- 036_remove_legacy_features.sql
-- Arc.fun Legacy Feature Removal & Database Cleanup Migration
--
-- Objective:
-- Forward-only database cleanup removing obsolete database structures and rows
-- associated with deprecated features:
--   1. Onchain Score / Score Gate & Access Requests (public.access_requests)
--   2. ArcFun Swap module settings from public.onchain_access_settings
--   3. Legacy swap configuration columns from public.user_security_settings
--
-- Preserved Active Functionality:
--   - Circle CCTP Bridge routes in public.onchain_access_settings
--   - Chat/Pay financial payments table, constraints, triggers, and RLS policies
--   - Consumed admin nonces table & replay attack protections
-- ==============================================================================

-- ==============================================================================
-- PREFLIGHT VERIFICATION QUERIES (READ-ONLY)
-- Run these before applying to review existing legacy data:
--
-- 1. Check if access_requests table exists and count rows:
--    SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'access_requests';
--
-- 2. Inspect module settings in onchain_access_settings:
--    SELECT module, mode, updated_at FROM public.onchain_access_settings;
--
-- 3. Check for legacy swap columns in user_security_settings:
--    SELECT column_name FROM information_schema.columns 
--    WHERE table_name = 'user_security_settings' 
--      AND column_name IN ('ai_swap_enabled', 'max_swap_usd', 'require_passkey_for_large_swaps');
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- PART 1: DROP OBSOLETE ACCESS_REQUESTS TABLE & ASSOCIATED POLICIES
-- ==============================================================================
-- Drop any remaining policies on public.access_requests
DROP POLICY IF EXISTS "Access requests viewable by owner" ON public.access_requests;
DROP POLICY IF EXISTS "Access requests viewable by owner or service" ON public.access_requests;
DROP POLICY IF EXISTS "Admins can update requests" ON public.access_requests;
DROP POLICY IF EXISTS "Users can insert their own requests" ON public.access_requests;
DROP POLICY IF EXISTS "Access requests are viewable by everyone" ON public.access_requests;

-- Revoke permissions
REVOKE ALL ON TABLE public.access_requests FROM anon, authenticated, service_role;

-- Drop indexes
DROP INDEX IF EXISTS public.idx_access_requests_wallet;
DROP INDEX IF EXISTS public.idx_access_requests_status;

-- Drop table cascade
DROP TABLE IF EXISTS public.access_requests CASCADE;


-- ==============================================================================
-- PART 2: PURGE OBSOLETE SWAP RECORDS FROM ONCHAIN_ACCESS_SETTINGS
-- ==============================================================================
-- Remove the deprecated 'swap' module row, preserving bridge route records
DELETE FROM public.onchain_access_settings 
WHERE module = 'swap';


-- ==============================================================================
-- PART 3: DROP OBSOLETE SWAP COLUMNS FROM USER_SECURITY_SETTINGS
-- ==============================================================================
ALTER TABLE IF EXISTS public.user_security_settings
  DROP COLUMN IF EXISTS ai_swap_enabled,
  DROP COLUMN IF EXISTS max_swap_usd,
  DROP COLUMN IF EXISTS require_passkey_for_large_swaps;

COMMIT;

-- ==============================================================================
-- POST-MIGRATION VERIFICATION QUERIES (READ-ONLY)
-- Run these after applying to confirm clean state:
--
-- 1. Confirm access_requests table is gone:
--    SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'access_requests';
--    -- Expected: 0
--
-- 2. Confirm no 'swap' module exists in onchain_access_settings:
--    SELECT * FROM public.onchain_access_settings WHERE module = 'swap';
--    -- Expected: 0 rows
--
-- 3. Confirm active bridge routes are preserved:
--    SELECT module, mode FROM public.onchain_access_settings;
--    -- Expected: bridge routes only
--
-- 4. Confirm payments and security policies remain intact:
--    SELECT COUNT(*) FROM pg_policies WHERE tablename = 'payments';
--    -- Expected: Active RLS policies
-- ==============================================================================

