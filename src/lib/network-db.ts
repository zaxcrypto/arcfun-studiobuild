import { SupabaseClient } from "@supabase/supabase-js";
import { NetworkMode } from "@/config/network-modes";

/**
 * Network-Scoped Supabase Query Wrapper
 * Prepares typed accessors for Phase 2 without making queries until
 * the Phase 1 migration is applied.
 */

export interface NetworkScopedDb {
  network: NetworkMode;
  client: SupabaseClient;
}

export function createNetworkScopedDb(client: SupabaseClient, network: NetworkMode): NetworkScopedDb {
  return {
    network,
    client,
  };
}

