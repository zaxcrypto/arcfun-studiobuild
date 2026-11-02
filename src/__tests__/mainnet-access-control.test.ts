import { resolveServerNetwork } from "../lib/network-mode-server";
import { setCachedMainnetAccessMode, invalidateMainnetAccessCache } from "../lib/mainnet-access";

describe("Mainnet Access Control (Public Live vs Admin-Only)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED;
    delete process.env.ARCFUN_MAINNET_ENABLED;
    // Set required RPCs so unready doesn't trigger
    process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL = "https://rpc.mainnet.arc.io";
    process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL = "https://mainnet.base.org";
    process.env.NEXT_PUBLIC_ARB_MAINNET_RPC_URL = "https://arb1.arbitrum.io/rpc";
    invalidateMainnetAccessCache();
  });

  afterAll(() => {
    process.env = originalEnv;
    invalidateMainnetAccessCache();
  });

  it("blocks non-admin users when mode is 'admin_only'", () => {
    setCachedMainnetAccessMode("admin_only");
    const req = new Request("https://arcfun.xyz/api/bridge/sync", {
      headers: {
        "x-arcfun-network": "mainnet",
        "x-user-address": "0x1111111111111111111111111111111111111111", // random non-admin
      },
    });

    const ctx = resolveServerNetwork(req);
    expect(ctx.status).toBe("refused");
    if (ctx.status === "refused") {
      expect(ctx.code).toBe("MAINNET_DISABLED");
    }
  });

  it("allows admin users when mode is 'admin_only'", () => {
    setCachedMainnetAccessMode("admin_only");
    const req = new Request("https://arcfun.xyz/api/bridge/sync", {
      headers: {
        "x-arcfun-network": "mainnet",
        "x-user-address": "0xd448777940dfabf65fd259fa8a9903e60e1ff178", // hardcoded admin
      },
    });

    const ctx = resolveServerNetwork(req);
    expect(ctx.status).toBe("ok");
    if (ctx.status === "ok") {
      expect(ctx.network).toBe("mainnet");
      expect(ctx.isMainnet).toBe(true);
    }
  });

  it("allows all non-admin public users when mode is 'open_to_everyone'", () => {
    setCachedMainnetAccessMode("open_to_everyone");
    const req = new Request("https://arcfun.xyz/api/bridge/sync", {
      headers: {
        "x-arcfun-network": "mainnet",
        "x-user-address": "0x1111111111111111111111111111111111111111", // random non-admin
      },
    });

    const ctx = resolveServerNetwork(req);
    expect(ctx.status).toBe("ok");
    if (ctx.status === "ok") {
      expect(ctx.network).toBe("mainnet");
      expect(ctx.isMainnet).toBe(true);
    }
  });
});

