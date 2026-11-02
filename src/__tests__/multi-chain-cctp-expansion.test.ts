import { MAINNET_CHAIN_REGISTRY, isFastTransferSupported, getActiveMainnetChains } from "../config/mainnet-chain-registry";
import { MAINNET_CCTP_DOMAINS, resolveCctpDomain, getCircleIrisApi } from "../lib/bridge/cctp-provider";
import { ChainRegistry } from "../lib/bridge/chain-registry";
import { isMainnetChain } from "../config/swap-contract";
import { CircleBridgeKitService } from "../lib/bridge/circle-bridge-kit-service";

describe("Multi-Chain CCTP Expansion Lifecycle Suite", () => {
  const verifiedChains = [
    { name: "Arc Mainnet", domain: 26, chainId: 5042, usdc: "0x3600000000000000000000000000000000000000", fast: false },
    { name: "Base Mainnet", domain: 6, chainId: 8453, usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", fast: true },
    { name: "Arbitrum Mainnet", domain: 3, chainId: 42161, usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", fast: true },
    { name: "Ethereum Mainnet", domain: 0, chainId: 1, usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", fast: true },
    { name: "OP Mainnet", domain: 2, chainId: 10, usdc: "0x0b2c639c533813f4aa9d7837caf62653d097ff85", fast: true },
    { name: "Polygon Mainnet", domain: 7, chainId: 137, usdc: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", fast: true },
    { name: "Avalanche Mainnet", domain: 1, chainId: 43114, usdc: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", fast: true },
    { name: "Sonic Mainnet", domain: 13, chainId: 146, usdc: "0x29219dd400f2Bf60E5a23d13Be72B486D4038894", fast: true },
    { name: "Ink Mainnet", domain: 21, chainId: 57073, usdc: "0x2D270e6886d130D724215A266106e6832161EAEd", fast: true },
    { name: "Unichain Mainnet", domain: 10, chainId: 130, usdc: "0x078D782b760474a361dDA0AF3839290b0EF57AD6", fast: true },
    { name: "Linea Mainnet", domain: 11, chainId: 59144, usdc: "0x176211869ca2b568f2a7d4ee941e073a821ee1ff", fast: true }
  ];

  it("1. Central Registry: Validates all 11 candidate chains with verified CREATE2 addresses and status", () => {
    const active = getActiveMainnetChains();
    expect(active.length).toBeGreaterThanOrEqual(11);

    for (const c of verifiedChains) {
      const meta = MAINNET_CHAIN_REGISTRY[c.name];
      expect(meta).toBeDefined();
      expect(meta.domain).toBe(c.domain);
      expect(meta.chainId).toBe(c.chainId);
      expect(meta.usdcAddress.toLowerCase()).toBe(c.usdc.toLowerCase());
      expect(meta.tokenMessengerV2.toLowerCase()).toBe("0x28b5a0e9c621a5badaa536219b3a228c8168cf5d");
      expect(meta.messageTransmitterV2.toLowerCase()).toBe("0x81d40f21f12a8f0e3252bccb954d722d4c464b64");
      expect(meta.status).toBe("ACTIVE");
      expect(meta.fastTransferSupported).toBe(c.fast);
    }
  });

  it("2. CCTP Domains: Validates CCTP V2 domain mapping & resolution across all 11 networks", () => {
    for (const c of verifiedChains) {
      const resolved = resolveCctpDomain(c.name, "mainnet");
      expect(resolved).toBeDefined();
      expect(resolved?.domain).toBe(c.domain);
      expect(resolved?.chainId).toBe(c.chainId);
      expect(resolved?.tokenMessenger.toLowerCase()).toBe("0x28b5a0e9c621a5badaa536219b3a228c8168cf5d");
      expect(resolved?.messageTransmitter.toLowerCase()).toBe("0x81d40f21f12a8f0e3252bccb954d722d4c464b64");
    }
  });

  it("3. Chain Registry: All 11 chains are registered with active status and explorer URL generators", () => {
    for (const c of verifiedChains) {
      const config = ChainRegistry.getChain(c.name);
      expect(config).toBeDefined();
      expect(config.status).toBe("ACTIVE");
      expect(config.chainId).toBe(c.chainId);

      const txUrl = ChainRegistry.getExplorerTxUrl(c.name, "0xabcdef123456");
      expect(txUrl).toBeTruthy();
      expect(txUrl).toContain("0xabcdef123456");
    }
  });

  it("4. Mode Isolation: All 11 chains are correctly detected as mainnet chains", () => {
    for (const c of verifiedChains) {
      expect(isMainnetChain(c.name)).toBe(true);
    }
    // Testnet chains must remain isolated
    expect(isMainnetChain("Arc Testnet")).toBe(false);
    expect(isMainnetChain("Base Sepolia")).toBe(false);
    expect(isMainnetChain("Arbitrum Sepolia")).toBe(false);
  });

  it("5. Fast Transfer Rule: Arc source transfers are always Standard, while L2<->L2 support Fast", () => {
    // Arc source must never allow Fast Transfer
    expect(isFastTransferSupported("Arc Mainnet", "Base Mainnet")).toBe(false);
    expect(isFastTransferSupported("Arc Mainnet", "Arbitrum Mainnet")).toBe(false);

    // L2 to L2 allows Fast Transfer
    expect(isFastTransferSupported("Base Mainnet", "Arbitrum Mainnet")).toBe(true);
    expect(isFastTransferSupported("Arbitrum Mainnet", "OP Mainnet")).toBe(true);
    expect(isFastTransferSupported("Polygon Mainnet", "Base Mainnet")).toBe(true);
  });

  it("6. Bridge Kit Service: Successfully resolves BridgeKit chain keys and objects for all 11 chains", () => {
    const kit = CircleBridgeKitService.getKit();
    expect(kit).toBeDefined();

    for (const c of verifiedChains) {
      const chainKey = CircleBridgeKitService.resolveChainKey(c.name);
      expect(chainKey).toBeTruthy();
      const bridgeKitChain = CircleBridgeKitService.resolveBridgeKitChain(c.name);
      expect(bridgeKitChain).toBeDefined();
    }
  });

  it("7. Iris API: Verifies official mainnet and testnet API URLs", () => {
    expect(getCircleIrisApi("mainnet")).toContain("iris-api.circle.com");
    expect(getCircleIrisApi("testnet")).toContain("iris-api-sandbox.circle.com");
  });
});

