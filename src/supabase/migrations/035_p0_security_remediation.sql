-- ==============================================================================
-- 035_p0_security_remediation.sql
-- Arc.fun P0 Financial Security & Mainnet Access Hardening Migration
--
-- Remediates:
--   P0-SEC-01 / P0-SEC-02: Payment Verification & Transaction Hash Replay
--   P0-SEC-03: Payments Row Level Security (RLS) & Column Tampering Protection
--   P0-SEC-04: Onchain Access Settings, Access Requests & Admin Nonce Hardening
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- PART 1: P0-SEC-02 — TRANSACTION HASH REPLAY PROTECTION
-- ==============================================================================
-- Create a partial unique index on confirmed payments.
-- Guarantees that a single on-chain transaction hash can NEVER confirm more than
-- one payment record, preventing double-credit and invoice replay attacks.
-- ==============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_confirmed_tx_hash 
ON public.payments (tx_hash) 
WHERE tx_hash IS NOT NULL AND status = 'confirmed';


-- ==============================================================================
-- PART 2: P0-SEC-03 — PAYMENTS TABLE RLS & COLUMN INTEGRITY ENFORCEMENT
-- ==============================================================================
-- 1. Ensure RLS is active
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- 2. Drop existing permissive and legacy update policies
DROP POLICY IF EXISTS "Permissive Policy" ON public.payments;
DROP POLICY IF EXISTS "Update own payments" ON public.payments;
DROP POLICY IF EXISTS "Insert own payments" ON public.payments;
DROP POLICY IF EXISTS "Read own payments" ON public.payments;
DROP POLICY IF EXISTS "Insert own pending payments" ON public.payments;
DROP POLICY IF EXISTS "Update own payments active status" ON public.payments;

-- 3. SELECT Policy: Participants can read their own payments
CREATE POLICY "Read own payments" ON public.payments
    FOR SELECT USING (
      (auth.jwt() ->> 'sub') = sender OR (auth.jwt() ->> 'sub') = receiver
    );

-- 4. INSERT Policy: Senders can only create payment intents in 'pending' status
-- Senders cannot self-confirm payments on insert!
CREATE POLICY "Insert own pending payments" ON public.payments
    FOR INSERT WITH CHECK (
      (auth.jwt() ->> 'sub') = sender AND status = 'pending'
    );

-- 5. UPDATE Policy: Participants can only update their own payments (e.g., active toggle)
CREATE POLICY "Update own payments active status" ON public.payments
    FOR UPDATE USING (
      (auth.jwt() ->> 'sub') = sender OR (auth.jwt() ->> 'sub') = receiver
    )
    WITH CHECK (
      (auth.jwt() ->> 'sub') = sender OR (auth.jwt() ->> 'sub') = receiver
    );

-- 6. Trigger Function: Defense-in-depth column protection
-- Rejects any client attempt to modify financial or identity columns (status, amount,
-- sender, receiver, token, tx_hash, currency, chain_id, payment_type). Authoritative transitions require service_role.
CREATE OR REPLACE FUNCTION public.protect_payments_financial_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Service role / backend server is authorized to perform state transitions
  IF auth.role() = 'service_role'
     OR (auth.jwt() ->> 'role') = 'service_role' 
     OR current_user = 'service_role' 
     OR coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Authenticated and anonymous clients are strictly blocked from tampering:
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Unauthorized: Payment status can only be modified by backend verification' 
      USING ERRCODE = 'P0403';
  END IF;

  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'Unauthorized: Payment amount cannot be modified' 
      USING ERRCODE = 'P0403';
  END IF;

  IF NEW.sender IS DISTINCT FROM OLD.sender OR NEW.receiver IS DISTINCT FROM OLD.receiver THEN
    RAISE EXCEPTION 'Unauthorized: Payment participants cannot be modified' 
      USING ERRCODE = 'P0403';
  END IF;

  IF NEW.token IS DISTINCT FROM OLD.token THEN
    RAISE EXCEPTION 'Unauthorized: Payment token cannot be modified' 
      USING ERRCODE = 'P0403';
  END IF;

  IF NEW.tx_hash IS DISTINCT FROM OLD.tx_hash THEN
    RAISE EXCEPTION 'Unauthorized: Payment transaction hash cannot be modified' 
      USING ERRCODE = 'P0403';
  END IF;

  -- Protection for currency, chain_id and payment_type (checked safely if columns exist):
  IF (to_jsonb(NEW) ? 'currency') AND ((to_jsonb(NEW) ->> 'currency') IS DISTINCT FROM (to_jsonb(OLD) ->> 'currency')) THEN
    RAISE EXCEPTION 'Unauthorized: Payment currency cannot be modified' 
      USING ERRCODE = 'P0403';
  END IF;

  IF (to_jsonb(NEW) ? 'chain_id') AND ((to_jsonb(NEW) ->> 'chain_id') IS DISTINCT FROM (to_jsonb(OLD) ->> 'chain_id')) THEN
    RAISE EXCEPTION 'Unauthorized: Payment chain_id cannot be modified' 
      USING ERRCODE = 'P0403';
  END IF;

  IF (to_jsonb(NEW) ? 'payment_type') AND ((to_jsonb(NEW) ->> 'payment_type') IS DISTINCT FROM (to_jsonb(OLD) ->> 'payment_type')) THEN
    RAISE EXCEPTION 'Unauthorized: Payment payment_type cannot be modified' 
      USING ERRCODE = 'P0403';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_payments_financial_fields ON public.payments;
CREATE TRIGGER trg_protect_payments_financial_fields
  BEFORE UPDATE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_payments_financial_fields();


-- ==============================================================================
-- PART 3: P0-SEC-04 — REVOKE PUBLIC WRITE ACCESS TO ONCHAIN ACCESS SETTINGS
-- ==============================================================================
-- 1. Ensure RLS is active on onchain_access_settings
ALTER TABLE public.onchain_access_settings ENABLE ROW LEVEL SECURITY;

-- 2. Revoke write privileges from public API roles (anon and authenticated)
REVOKE INSERT, UPDATE, DELETE ON public.onchain_access_settings FROM anon, authenticated;
GRANT ALL ON TABLE public.onchain_access_settings TO service_role;

-- 3. Drop all permissive policies
DROP POLICY IF EXISTS "Admins can insert settings" ON public.onchain_access_settings;
DROP POLICY IF EXISTS "Admins can update settings" ON public.onchain_access_settings;
DROP POLICY IF EXISTS "Settings are viewable by everyone" ON public.onchain_access_settings;

-- 4. Clean Read Policy: Settings are viewable so public frontend can display route/module status
CREATE POLICY "Settings are viewable by everyone" ON public.onchain_access_settings
    FOR SELECT USING (true);

-- 5. Safe backward-compatible handling for access_requests if table still exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'access_requests') THEN
    EXECUTE 'ALTER TABLE public.access_requests ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON public.access_requests FROM anon, authenticated;';
    EXECUTE 'GRANT ALL ON TABLE public.access_requests TO service_role;';
    EXECUTE 'DROP POLICY IF EXISTS "Admins can update requests" ON public.access_requests;';
    EXECUTE 'DROP POLICY IF EXISTS "Access requests are viewable by everyone" ON public.access_requests;';
    EXECUTE 'DROP POLICY IF EXISTS "Users can insert their own requests" ON public.access_requests;';
    EXECUTE 'DROP POLICY IF EXISTS "Access requests viewable by owner or service" ON public.access_requests;';
    EXECUTE 'DROP POLICY IF EXISTS "Access requests viewable by owner" ON public.access_requests;';
    EXECUTE 'CREATE POLICY "Access requests viewable by owner" ON public.access_requests FOR SELECT USING ((auth.jwt() ->> ''sub'') = wallet_address);';
  END IF;
END $$;


-- ==============================================================================
-- PART 4: ADMIN NONCE REPLAY PREVENTION TABLE
-- ==============================================================================
-- Supports atomic nonce consumption in /api/admin/action to prevent signature replays
CREATE TABLE IF NOT EXISTS public.consumed_admin_nonces (
    nonce TEXT PRIMARY KEY,
    admin_wallet TEXT NOT NULL,
    action TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consumed_admin_nonces_created_at 
ON public.consumed_admin_nonces(created_at);

ALTER TABLE public.consumed_admin_nonces ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.consumed_admin_nonces FROM anon, authenticated;
GRANT ALL ON TABLE public.consumed_admin_nonces TO service_role;

COMMIT;
