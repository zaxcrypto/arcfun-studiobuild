import { createClient } from "@supabase/supabase-js";

export interface CctpGasSettings {
  minRelayerBalanceUsd: number;
  maxSponsoredClaimFeeUsd: number;
  updatedAt: string;
  updatedBy: string;
}

export const DEFAULT_CCTP_GAS_SETTINGS: CctpGasSettings = {
  minRelayerBalanceUsd: 2.0,
  maxSponsoredClaimFeeUsd: 0.1,
  updatedAt: new Date(0).toISOString(),
  updatedBy: "system",
};

// In-memory cache with short TTL (10s) and explicit invalidation
let cachedSettings: CctpGasSettings | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 10_000;

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/**
 * Invalidate in-memory cache upon admin update
 */
export function invalidateCctpGasSettingsCache(): void {
  cachedSettings = null;
  cacheExpiry = 0;
}

/**
 * Read effective CCTP gas thresholds from the database with fail-safe defaults
 */
export async function getCctpGasSettings(): Promise<CctpGasSettings> {
  const now = Date.now();
  if (cachedSettings && now < cacheExpiry) {
    return cachedSettings;
  }

  const client = getSupabaseAdmin();
  if (!client) {
    return DEFAULT_CCTP_GAS_SETTINGS;
  }

  try {
    const { data, error } = await client
      .from("cctp_gas_settings")
      .select("min_relayer_balance_usd, max_sponsored_claim_fee_usd, updated_at, updated_by")
      .eq("id", "default")
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.warn("[CctpGasSettings] Error reading settings from DB, using defaults:", error.message);
      }
      return DEFAULT_CCTP_GAS_SETTINGS;
    }

    const minBalance = Number(data.min_relayer_balance_usd);
    const maxFee = Number(data.max_sponsored_claim_fee_usd);

    cachedSettings = {
      minRelayerBalanceUsd: Number.isFinite(minBalance) && minBalance >= 0 ? minBalance : DEFAULT_CCTP_GAS_SETTINGS.minRelayerBalanceUsd,
      maxSponsoredClaimFeeUsd: Number.isFinite(maxFee) && maxFee >= 0 ? maxFee : DEFAULT_CCTP_GAS_SETTINGS.maxSponsoredClaimFeeUsd,
      updatedAt: data.updated_at || new Date().toISOString(),
      updatedBy: data.updated_by || "system",
    };
    cacheExpiry = now + CACHE_TTL_MS;
    return cachedSettings;
  } catch (err) {
    console.warn("[CctpGasSettings] Exception reading settings from DB, using defaults:", err);
    return DEFAULT_CCTP_GAS_SETTINGS;
  }
}

/**
 * Server-side update of CCTP gas thresholds (admin authenticated only)
 */
export async function updateCctpGasSettings(params: {
  minRelayerBalanceUsd?: number;
  maxSponsoredClaimFeeUsd?: number;
  min_relayer_balance_usd?: number;
  max_sponsored_claim_fee_usd?: number;
  updatedBy?: string;
  updated_by?: string;
}): Promise<CctpGasSettings> {
  const client = getSupabaseAdmin();
  if (!client) {
    throw new Error("Database service client not configured");
  }

  // Load current settings to allow independent updating
  const current = await getCctpGasSettings();

  const updater = (params.updatedBy || params.updated_by || 'admin').toLowerCase();
  const updates: Record<string, any> = {
    updated_at: new Date().toISOString(),
    updated_by: updater,
  };

  const rawMin = params.minRelayerBalanceUsd !== undefined ? params.minRelayerBalanceUsd : params.min_relayer_balance_usd;
  if (rawMin !== undefined) {
    const val = Number(rawMin);
    if (!Number.isFinite(val) || val < 0) {
      throw new Error("Invalid minimum relayer balance. Must be a finite non-negative number.");
    }
    updates.min_relayer_balance_usd = parseFloat(val.toFixed(4));
  }

  const rawMax = params.maxSponsoredClaimFeeUsd !== undefined ? params.maxSponsoredClaimFeeUsd : params.max_sponsored_claim_fee_usd;
  if (rawMax !== undefined) {
    const val = Number(rawMax);
    if (!Number.isFinite(val) || val < 0) {
      throw new Error("Invalid maximum sponsored claim fee. Must be a finite non-negative number.");
    }
    updates.max_sponsored_claim_fee_usd = parseFloat(val.toFixed(4));
  }

  const { data, error } = await client
    .from("cctp_gas_settings")
    .upsert({
      id: "default",
      min_relayer_balance_usd: updates.min_relayer_balance_usd ?? current.minRelayerBalanceUsd,
      max_sponsored_claim_fee_usd: updates.max_sponsored_claim_fee_usd ?? current.maxSponsoredClaimFeeUsd,
      updated_at: updates.updated_at,
      updated_by: updates.updated_by,
    })
    .select("min_relayer_balance_usd, max_sponsored_claim_fee_usd, updated_at, updated_by")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to persist CCTP gas settings in database");
  }

  invalidateCctpGasSettingsCache();

  return {
    minRelayerBalanceUsd: Number(data.min_relayer_balance_usd),
    maxSponsoredClaimFeeUsd: Number(data.max_sponsored_claim_fee_usd),
    updatedAt: data.updated_at,
    updatedBy: data.updated_by,
  };
}

