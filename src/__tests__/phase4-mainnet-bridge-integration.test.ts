import { resolveServerNetwork, guardMainnetApi } from "../lib/network-mode-server";
import { isMainnetFeatureEnabled, validateBridgeForMode, chainDisplayName } from "../config/network-modes";
import { getSupportedChains, isMainnetChain, isTestnetChain } from "../config/swap-contract";
import { getCctpDomains } from "../lib/bridge/cctp-provider";

describe("Phase 4: Mainnet CCTP Bridge Website Integration Tests", () => {
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

  describe("1. Mainnet Feature Flag & Fail-Closed Safety", () => {
    it("mainnet is disabled by default", () => {
      expect(isMainnetFeatureEnabled()).toBe(false);
    });

    it("guardMainnetApi blocks explicit mainnet requests when mainnet is disabled", () => {
      const req = new Request("https://arcfun.xyz/api/bridge/sync", {
        headers: { "x-arcfun-network": "mainnet" },
      });
      const refusal = guardMainnetApi(req);
      expect(refusal).not.toBeNull();
      expect(refusal?.status).toBe(503);
    });

    it("guardMainnetApi allows testnet requests through safely", () => {
      const req = new Request("https://arcfun.xyz/api/bridge/sync", {
        headers: { "x-arcfun-network": "testnet" },
      });
      const refusal = guardMainnetApi(req);
      expect(refusal).toBeNull();
    });
  });

  describe("2. Mainnet Supported Chains Scoping", () => {
    it("Mainnet mode returns supported CCTP Mainnet chains", () => {
      const chains = getSupportedChains("mainnet");
      expect(chains).toContain("Arc Mainnet");
      expect(chains).toContain("Base Mainnet");
      expect(chains).toContain("Solana Mainnet");
      expect(chains).not.toContain("Sui Mainnet");
    });

    it("Testnet mode continues returning all Testnet chains without regression", () => {
      const testnetChains = getSupportedChains("testnet");
      expect(testnetChains).toContain("Arc Testnet");
      expect(testnetChains).toContain("Base Sepolia");
      expect(testnetChains).toContain("Ethereum Sepolia");
      expect(testnetChains).toContain("Solana Devnet");
      expect(testnetChains).toContain("Sui Testnet");
      expect(testnetChains).toContain("Stellar Testnet");
    });

    it("correctly identifies mainnet vs testnet chains", () => {
      expect(isMainnetChain("Arc Mainnet")).toBe(true);
      expect(isMainnetChain("Base Mainnet")).toBe(true);
      expect(isMainnetChain("Arc Testnet")).toBe(false);
      expect(isTestnetChain("Arc Testnet")).toBe(true);
      expect(isTestnetChain("Base Mainnet")).toBe(false);
    });
  });

  describe("3. Bridge Route Validation (Arc -> Base Mainnet)", () => {
    it("validates Arc Mainnet -> Base Mainnet USDC route when mainnet is enabled", () => {
      process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED = "true";
      const err = validateBridgeForMode("mainnet", "Arc Mainnet", "Base Mainnet", "USDC", "USDC");
      expect(err).toBeNull();
    });

    it("rejects non-USDC tokens on Mainnet bridge", () => {
      process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED = "true";
      const err = validateBridgeForMode("mainnet", "Arc Mainnet", "Base Mainnet", "EURC", "EURC");
      expect(err).toBe("Only USDC can be bridged on Mainnet.");
    });

    it("rejects unverified chains on Mainnet bridge", () => {
      process.env.NEXT_PUBLIC_ARCFUN_MAINNET_ENABLED = "true";
      const err = validateBridgeForMode("mainnet", "Arc Mainnet", "Solana Mainnet", "USDC", "USDC");
      expect(err).toBe("This bridge route is only available on Testnet.");
    });

    it("rejects Mainnet routes while in Testnet mode", () => {
      const err = validateBridgeForMode("testnet", "Arc Mainnet", "Base Mainnet", "USDC", "USDC");
      expect(err).toBe("This is a Mainnet route. Switch ArcFun to Mainnet to use it.");
    });
  });

  describe("4. CCTP V2 Mainnet Contract & Domain Specifications", () => {
    it("uses verified Arc Mainnet and Base Mainnet domain IDs and contracts", () => {
      const domains = getCctpDomains("mainnet");
      const arc = domains["Arc Mainnet"];
      const base = domains["Base Mainnet"];

      expect(arc).toBeDefined();
      expect(arc.domain).toBe(26);
      expect(arc.chainId).toBe(5042);
      expect(arc.usdc.toLowerCase()).toBe("0x3600000000000000000000000000000000000000");
      expect(arc.tokenMessenger.toLowerCase()).toBe("0x28b5a0e9c621a5badaa536219b3a228c8168cf5d");
      expect(arc.messageTransmitter.toLowerCase()).toBe("0x81d40f21f12a8f0e3252bccb954d722d4c464b64");

      expect(base).toBeDefined();
      expect(base.domain).toBe(6);
      expect(base.chainId).toBe(8453);
      expect(base.usdc.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
      expect(base.tokenMessenger.toLowerCase()).toBe("0x28b5a0e9c621a5badaa536219b3a228c8168cf5d");
      expect(base.messageTransmitter.toLowerCase()).toBe("0x81d40f21f12a8f0e3252bccb954d722d4c464b64");
    });
  });
});

