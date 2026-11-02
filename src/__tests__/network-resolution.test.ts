import { resolveServerNetwork, guardMainnetApi } from "../lib/network-mode-server";

describe("Network Resolution & Server Safety Gates", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED;
    delete process.env.ARCFUN_MAINNET_ENABLED;
    delete process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL;
    delete process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL;
    delete process.env.NEXT_PUBLIC_ARB_MAINNET_RPC_URL;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("1. Missing / Omitted Header", () => {
    it("safely defaults to testnet when header is absent", () => {
      const req = new Request("https://arcfun.xyz/api/test");
      const ctx = resolveServerNetwork(req);

      expect(ctx.status).toBe("ok");
      if (ctx.status === "ok") {
        expect(ctx.network).toBe("testnet");
        expect(ctx.isMainnet).toBe(false);
      }
      expect(guardMainnetApi(req)).toBeNull();
    });

    it("safely defaults to testnet when header is empty string or whitespace", () => {
      const req = new Request("https://arcfun.xyz/api/test", {
        headers: { "x-arcfun-network": "   " },
      });
      const ctx = resolveServerNetwork(req);

      expect(ctx.status).toBe("ok");
      if (ctx.status === "ok") {
        expect(ctx.network).toBe("testnet");
        expect(ctx.isMainnet).toBe(false);
      }
      expect(guardMainnetApi(req)).toBeNull();
    });
  });

  describe("2. Explicit Testnet Request", () => {
    it("resolves to testnet successfully", () => {
      const req = new Request("https://arcfun.xyz/api/test", {
        headers: { "x-arcfun-network": "testnet" },
      });
      const ctx = resolveServerNetwork(req);

      expect(ctx.status).toBe("ok");
      if (ctx.status === "ok") {
        expect(ctx.network).toBe("testnet");
        expect(ctx.isMainnet).toBe(false);
      }
      expect(guardMainnetApi(req)).toBeNull();
    });
  });

  describe("3. Explicit Mainnet Request When Disabled", () => {
    it("strictly refuses and does NOT fall back to testnet", () => {
      process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED = "false";
      process.env.ARCFUN_MAINNET_ENABLED = "false";

      const req = new Request("https://arcfun.xyz/api/test", {
        headers: { "x-arcfun-network": "mainnet" },
      });
      const ctx = resolveServerNetwork(req);

      expect(ctx.status).toBe("refused");
      if (ctx.status === "refused") {
        expect(ctx.network).toBeUndefined();
        expect(ctx.code).toBe("MAINNET_DISABLED");
      }

      const guardRes = guardMainnetApi(req);
      expect(guardRes).not.toBeNull();
      expect(guardRes?.status).toBe(503);
    });
  });

  describe("4. Explicit Mainnet Request When Enabled But Unready", () => {
    it("refuses with MAINNET_UNREADY when RPC endpoints are missing", () => {
      process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED = "true";
      // Intentionally omit REQUIRED_MAINNET_VARS

      const req = new Request("https://arcfun.xyz/api/test", {
        headers: { "x-arcfun-network": "mainnet" },
      });
      const ctx = resolveServerNetwork(req);

      expect(ctx.status).toBe("refused");
      if (ctx.status === "refused") {
        expect(ctx.network).toBeUndefined();
        expect(ctx.code).toBe("MAINNET_UNREADY");
        expect(ctx.error).toContain("Missing:");
      }

      const guardRes = guardMainnetApi(req);
      expect(guardRes).not.toBeNull();
      expect(guardRes?.status).toBe(503);
    });
  });

  describe("5. Explicit Mainnet Request When Enabled And Ready", () => {
    it("resolves to mainnet successfully", () => {
      process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED = "true";
      process.env.NEXT_PUBLIC_ARC_MAINNET_RPC_URL = "https://rpc.mainnet.arc.io";
      process.env.NEXT_PUBLIC_BASE_MAINNET_RPC_URL = "https://mainnet.base.org";
      process.env.NEXT_PUBLIC_ARB_MAINNET_RPC_URL = "https://arb1.arbitrum.io/rpc";

      const req = new Request("https://arcfun.xyz/api/test", {
        headers: { "x-arcfun-network": "mainnet" },
      });
      const ctx = resolveServerNetwork(req);

      expect(ctx.status).toBe("ok");
      if (ctx.status === "ok") {
        expect(ctx.network).toBe("mainnet");
        expect(ctx.isMainnet).toBe(true);
      }
      expect(guardMainnetApi(req)).toBeNull();
    });
  });

  describe("6. Invalid / Unrecognized Network Header", () => {
    it("refuses with INVALID_NETWORK_HEADER", () => {
      const req = new Request("https://arcfun.xyz/api/test", {
        headers: { "x-arcfun-network": "ethereum-mainnet-custom" },
      });
      const ctx = resolveServerNetwork(req);

      expect(ctx.status).toBe("refused");
      if (ctx.status === "refused") {
        expect(ctx.code).toBe("INVALID_NETWORK_HEADER");
      }

      const guardRes = guardMainnetApi(req);
      expect(guardRes?.status).toBe(503);
    });
  });
});

