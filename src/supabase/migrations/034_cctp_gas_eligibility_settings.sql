-- Migration: 034_cctp_gas_eligibility_settings.sql
-- Description: Dynamic CCTP sponsored claim gas eligibility settings and admin configuration table

BEGIN;

CREATE TABLE IF NOT EXISTS public.cctp_gas_settings (
  id text PRIMARY KEY DEFAULT 'default',
  min_relayer_balance_usd numeric(12, 4) NOT NULL DEFAULT 2.0000,
  max_sponsored_claim_fee_usd numeric(12, 4) NOT NULL DEFAULT 0.1000,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT 'system'
);

-- Seed default configuration if empty
INSERT INTO public.cctp_gas_settings (id, min_relayer_balance_usd, max_sponsored_claim_fee_usd, updated_at, updated_by)
VALUES ('default', 2.0000, 0.1000, now(), 'system')
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE public.cctp_gas_settings ENABLE ROW LEVEL SECURITY;

-- Grant SELECT privileges to anon and authenticated roles
GRANT SELECT ON public.cctp_gas_settings TO anon, authenticated;

-- Allow public read of gas eligibility settings (needed for frontend UI pre-flight)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'cctp_gas_settings' AND policyname = 'Public read cctp_gas_settings'
  ) THEN
    CREATE POLICY "Public read cctp_gas_settings" 
    ON public.cctp_gas_settings 
    FOR SELECT 
    USING (true);
  END IF;
END $$;

-- Revoke mutation rights from anon/authenticated (enforce service_role and admin API authorization)
REVOKE INSERT, UPDATE, DELETE ON public.cctp_gas_settings FROM anon, authenticated;

COMMIT;

