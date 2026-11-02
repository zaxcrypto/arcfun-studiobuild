import { isMainnetFeatureEnabled } from "@/config/network-modes";

export type MainnetAccessMode = "open_to_everyone" | "admin_only";

// In-memory cache with 10s TTL
let cachedMode: MainnetAccessMode | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 10_000;

export function normalizeMainnetAccessMode(raw?: string | null): MainnetAccessMode {
  if (!raw) return "admin_only";
  const lower = raw.trim().toLowerCase();
  if (lower.includes("open") || lower === "open_to_everyone") {
    return "open_to_everyone";
  }
  return "admin_only";
}

/**
 * Synchronously returns the currently cached Mainnet access mode.
 * Returns null if not yet loaded into cache.
 */
export function getCachedMainnetAccessMode(): MainnetAccessMode | null {
  return cachedMode;
}

/**
 * Updates the in-memory cache directly (used when admin saves a setting).
 */
export function setCachedMainnetAccessMode(mode: string | null | undefined): void {
  cachedMode = normalizeMainnetAccessMode(mode);
  cacheExpiry = Date.now() + CACHE_TTL_MS;
}

/**
 * Invalidates the in-memory cache to force a fresh DB lookup on next read.
 */
export function invalidateMainnetAccessCache(): void {
  cachedMode = null;
  cacheExpiry = 0;
}

/**
 * Fetches the effective Mainnet access mode from `onchain_access_settings`.
 * Falls back to environment variables if database is unreachable or unset.
 */
export async function getMainnetAccessMode(): Promise<MainnetAccessMode> {
  const now = Date.now();
  if (cachedMode !== null && now < cacheExpiry) {
    return cachedMode;
  }

  // Check if server-side environment is available
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const fallback = isMainnetFeatureEnabled() ? "open_to_everyone" : "admin_only";
    cachedMode = fallback;
    cacheExpiry = now + CACHE_TTL_MS;
    return fallback;
  }

  try {
    const { supabaseAdmin } = await import("@/lib/supabase-admin");
    const { data, error } = await supabaseAdmin
      .from("onchain_access_settings")
      .select("mode")
      .eq("module", "mainnet_access")
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.warn("[MainnetAccess] Warning reading onchain_access_settings:", error.message);
      }
      const fallback = isMainnetFeatureEnabled() ? "open_to_everyone" : "admin_only";
      cachedMode = fallback;
      cacheExpiry = now + CACHE_TTL_MS;
      return fallback;
    }

    const resolved = normalizeMainnetAccessMode(data.mode);
    cachedMode = resolved;
    cacheExpiry = now + CACHE_TTL_MS;
    return resolved;
  } catch (err: any) {
    console.warn("[MainnetAccess] Failed to query mainnet_access setting:", err?.message || err);
    const fallback = cachedMode ?? (isMainnetFeatureEnabled() ? "open_to_everyone" : "admin_only");
    return fallback;
  }
}

