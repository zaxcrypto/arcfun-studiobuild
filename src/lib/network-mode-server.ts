import { NextResponse } from "next/server";
import { isMainnetFeatureEnabled, NetworkMode } from "@/config/network-modes";
import { getMainnetReadiness } from "@/lib/mainnet-readiness";
import { isAdmin } from "@/lib/admin";
import { getCachedMainnetAccessMode } from "@/lib/mainnet-access";

/**
 * Strictly Discriminated Server-Validated Network Resolution Context
 *
 * Types:
 * - "ok": Request is valid for the resolved network.
 * - "refused": Explicit Mainnet was requested, but Mainnet is disabled, unready,
 *   or invalid. Crucially: `network` is undefined to strictly prevent callers
 *   from silently using it.
 */
export type ValidatedNetworkContext =
  | {
      status: "ok";
      network: NetworkMode;
      isMainnet: boolean;
    }
  | {
      status: "refused";
      network?: never;
      isMainnet: false;
      error: string;
      code: "MAINNET_DISABLED" | "MAINNET_UNREADY" | "INVALID_NETWORK_HEADER";
    };

/**
 * Resolves the network context server-side.
 * Never trusts client headers as proof of authorization or readiness.
 *
 * Rules:
 * 1. Omitted header => Defaults safely to Testnet (`status: "ok"`).
 * 2. Explicit 'testnet' => Resolves to Testnet (`status: "ok"`).
 * 3. Explicit 'mainnet' => Verifies global feature flag AND readiness.
 *    If either fails, returns `status: "refused"` with NO fallback network.
 * 4. Any other unrecognized header => Refused (`status: "refused"`).
 */
export function resolveServerNetwork(req: Request): ValidatedNetworkContext {
  const rawHeader = req.headers.get("x-arcfun-network");

  // 1. Omitted header: Safe default to Testnet
  if (!rawHeader || rawHeader.trim() === "") {
    return {
      status: "ok",
      network: "testnet",
      isMainnet: false,
    };
  }

  const normalized = rawHeader.trim().toLowerCase();

  // 2. Explicit Testnet Request
  if (normalized === "testnet") {
    return {
      status: "ok",
      network: "testnet",
      isMainnet: false,
    };
  }

  // 3. Explicit Mainnet Request: Strict fail-closed verification
  if (normalized === "mainnet") {
    const callerAddress = req.headers.get("x-user-address") || req.headers.get("x-wallet-address");
    const userIsAdmin = isAdmin(callerAddress || undefined);

    const accessMode = getCachedMainnetAccessMode();
    const isGloballyOpen = accessMode === "open_to_everyone" || (accessMode === null && isMainnetFeatureEnabled());

    if (!isGloballyOpen && !userIsAdmin) {
      return {
        status: "refused",
        isMainnet: false,
        error: "ArcFun Mainnet is currently restricted to administrators.",
        code: "MAINNET_DISABLED",
      };
    }

    const readiness = getMainnetReadiness(true);
    if (!readiness.ready) {
      return {
        status: "refused",
        isMainnet: false,
        error: `ArcFun Mainnet is pending deployment readiness. Missing: ${readiness.missing.join(", ")}`,
        code: "MAINNET_UNREADY",
      };
    }

    return {
      status: "ok",
      network: "mainnet",
      isMainnet: true,
    };
  }

  // 4. Invalid / Unrecognized header value
  return {
    status: "refused",
    isMainnet: false,
    error: `Invalid network requested: '${rawHeader}'. Supported networks are 'testnet' and 'mainnet'.`,
    code: "INVALID_NETWORK_HEADER",
  };
}

/**
 * Strict Route Guardkeeper:
 * If the network context is refused, immediately returns a 503 response.
 * Callers MUST check this before any database query or transaction operation.
 */
export function guardMainnetApi(req: Request): NextResponse | null {
  const context = resolveServerNetwork(req);

  if (context.status === "refused") {
    return NextResponse.json(
      {
        error: context.error,
        code: context.code,
      },
      { status: 503 }
    );
  }

  return null;
}
