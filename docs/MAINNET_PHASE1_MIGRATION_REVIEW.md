# ArcFun Mainnet Phase 1 Database Migration Review

**Migration File:** `src/supabase/migrations/033_network_scoping_additive.sql`  
**Target Project:** `arcfun-dapps-hub` (`becajowdwesequfqgwou`)  
**Phase Objective:** Additive network isolation preserving 100% of existing Testnet operations, data, and constraints.

---

## 1. Technical Summary of Changes & Corrections

1. **Trigger Coverage on `burn_tx_hash`:**
   - The `bridge_history_sync` trigger now listens to `AFTER INSERT OR UPDATE OF bridge_status, mint_tx_hash, burn_tx_hash, network`.
   - Ensures that any retroactive correction or backfilling of the burn transaction hash immediately reconciles to `unified_transaction_history`.

2. **Hardened `SECURITY DEFINER` Search Path:**
   - Both `auto_prune_bridge_transactions()` and `sync_bridge_to_history()` explicitly set:
     ```sql
     SET search_path = pg_catalog, public, pg_temp;
     ```
   - Prioritizes core system functions in `pg_catalog`, preventing malicious schema or function hijacking.
   - **Public Schema Writable Evaluation:** In Supabase, the `anon` and `authenticated` roles do not hold `CREATE` on the `public` schema (only `USAGE`), meaning untrusted users cannot create rogue objects in `public`. Setting `pg_catalog, public, pg_temp` is the recommended security posture.

3. **Strict Column-Verified Legacy Index Replacement:**
   - Before dropping any constraint or index on `unified_transaction_history`, the migration checks `pg_constraint` and `pg_index` to confirm that the indexed column list is **exactly `ARRAY['tx_hash', 'type']`**.
   - No index is dropped by name alone. Unrelated indexes and constraints are completely safe.

4. **Guaranteed Idempotence:**
   - Checks `information_schema.columns` for `network` and `pg_constraint` for `chk_*_network` independently.
   - Rerunning the migration if partially applied or previously executed will execute cleanly without throwing duplicate column or duplicate constraint errors.

5. **Coexisting Settings Uniqueness:**
   - Retains `UNIQUE(module)` on `onchain_access_settings` to ensure 100% compatibility with running Testnet code.
   - Creates composite unique index `idx_onchain_access_network_module` on `(network, module)`.

---

## 2. Pre-Migration Verification SQL

Execute the following queries in the Supabase SQL Editor prior to running the migration to record baseline metrics:

```sql
-- 1. Check current row counts
SELECT 'unified_transaction_history' AS tbl, count(*) FROM public.unified_transaction_history
UNION ALL
SELECT 'bridge_transactions', count(*) FROM public.bridge_transactions
UNION ALL
SELECT 'onchain_access_settings', count(*) FROM public.onchain_access_settings
UNION ALL
SELECT 'admin_audit_logs', count(*) FROM public.admin_audit_logs;

-- 2. Inspect existing constraints on unified_transaction_history
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'public.unified_transaction_history'::regclass;

-- 3. Verify onchain_access_settings uniqueness
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conrelid = 'public.onchain_access_settings'::regclass;
```

---

## 3. Post-Migration Verification SQL

Execute these queries immediately after applying the migration to verify success:

```sql
-- 1. Verify all existing records received 'testnet'
SELECT 
  'unified_transaction_history' AS tbl,
  count(*) FILTER (WHERE network = 'testnet') AS testnet_rows,
  count(*) FILTER (WHERE network != 'testnet') AS non_testnet_rows
FROM public.unified_transaction_history
UNION ALL
SELECT 
  'bridge_transactions',
  count(*) FILTER (WHERE network = 'testnet'),
  count(*) FILTER (WHERE network != 'testnet')
FROM public.bridge_transactions;

-- 2. Verify new composite index exists
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'unified_transaction_history' 
  AND indexname = 'idx_unified_history_network_tx_type';

-- 3. Verify onchain_access_settings composite index exists
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'onchain_access_settings' 
  AND indexname = 'idx_onchain_access_network_module';

-- 4. Test trigger synchronization with a temporary probe
DO $$
DECLARE
  v_test_id uuid;
  v_burn_hash text := '0xtest_migration_probe_' || floor(random() * 1000000)::text;
  v_history_status text;
BEGIN
  -- Insert test bridge transaction
  INSERT INTO public.bridge_transactions (
    wallet_address, source_chain, destination_chain, token_symbol, amount, burn_tx_hash, bridge_status, network
  ) VALUES (
    '0x0000000000000000000000000000000000000000', 'Ethereum Sepolia', 'Arc Testnet', 'USDC', '1', v_burn_hash, 'PENDING', 'testnet'
  ) RETURNING id INTO v_test_id;

  -- Verify sync on INSERT
  SELECT status INTO v_history_status FROM public.unified_transaction_history WHERE tx_hash = v_burn_hash;
  ASSERT v_history_status = 'PENDING', 'History sync on INSERT failed!';

  -- Update test bridge transaction burn hash and status
  UPDATE public.bridge_transactions 
  SET bridge_status = 'COMPLETED', mint_tx_hash = '0xmint_' || v_burn_hash
  WHERE id = v_test_id;

  -- Verify sync on UPDATE
  SELECT status INTO v_history_status FROM public.unified_transaction_history WHERE tx_hash = v_burn_hash;
  ASSERT v_history_status = 'COMPLETED', 'History sync on UPDATE failed!';

  -- Cleanup probe
  DELETE FROM public.unified_transaction_history WHERE tx_hash = v_burn_hash;
  DELETE FROM public.bridge_transactions WHERE id = v_test_id;
  RAISE NOTICE 'Migration verification probe succeeded!';
END $$;
```

---

## 4. Rollback Strategy & Critical Safety Limits

### Rollback SQL (PRE-MAINNET-TRAFFIC ONLY)
> [!CAUTION]
> **PRE-MAINNET-TRAFFIC ONLY:** The script below is valid **only before any genuine Mainnet records are written**. It is **not** a complete schema rollback and must **never** be executed once Mainnet traffic exists.

```sql
-- PRE-MAINNET-TRAFFIC ROLLBACK ONLY
DROP TRIGGER IF EXISTS bridge_history_sync ON public.bridge_transactions;

CREATE OR REPLACE FUNCTION public.sync_bridge_to_history()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.unified_transaction_history (
    wallet_address, type, status, tx_hash, created_at, updated_at
  ) VALUES (
    NEW.wallet_address, 'bridge_cctp', NEW.bridge_status, NEW.burn_tx_hash, NEW.created_at, NOW()
  )
  ON CONFLICT (tx_hash, type) DO UPDATE SET
    status = EXCLUDED.status,
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER bridge_history_sync
AFTER INSERT ON public.bridge_transactions
FOR EACH ROW
EXECUTE FUNCTION public.sync_bridge_to_history();

-- Revert pruning to pre-033 global behavior
CREATE OR REPLACE FUNCTION public.auto_prune_bridge_transactions()
RETURNS trigger AS $$
BEGIN
  DELETE FROM public.bridge_transactions
  WHERE created_at < NOW() - INTERVAL '7 days'
    AND bridge_status IN ('COMPLETED', 'FAILED');
  DELETE FROM public.bridge_transactions
  WHERE id NOT IN (
    SELECT id FROM public.bridge_transactions
    ORDER BY created_at DESC
    LIMIT 100
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### Critical Rollback Limitations Once Mainnet Traffic Exists:
> [!WARNING]
> Once genuine Mainnet transactions are recorded in `unified_transaction_history` or `bridge_transactions`:
> 1. **Immediate Data Deletion:** Restoring the global `auto_prune_bridge_transactions()` function will immediately cap the table to the top 100 records globally, permanently deleting Mainnet transactions past rank 100.
> 2. **Constraint Failure:** Restoring global `UNIQUE(tx_hash, type)` will fail if identical hashes exist across Testnet and Mainnet.
> 3. **Manual Archival Mandatory:** Any post-launch rollback requires backing up and extracting all rows with `network = 'mainnet'` before altering table structures.
