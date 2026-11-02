/**
 * Automated Test Suite: Circle Bridge Kit Integration Phase 1
 *
 * Verifies:
 * 1. Bridge Kit initialization & exported types.
 * 2. Arc Mainnet & Base Mainnet chain configuration parameters.
 * 3. Viem Adapter factory instantiation & address context.
 * 4. Arc -> Base route discovery & provider selection.
 * 5. Standard Transfer (SLOW) configuration on Arc.
 * 6. Rejection of Fast Transfer when source is Arc.
 * 7. Unsupported chain / invalid route rejection.
 * 8. Strict network mode isolation (Mainnet disabled behavior).
 */

const assert = require("assert");
const { BridgeKit, TransferSpeed, Arc, Base, Ethereum } = require("@circle-fin/bridge-kit");
const { createViemAdapterFromPrivateKey } = require("@circle-fin/adapter-viem-v2");

async function runTests() {
  console.log("=== STARTING CIRCLE BRIDGE KIT PHASE 1 TESTS ===\n");
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
    }
  }

  async function testAsync(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (e) {
      console.error(`[FAIL] ${name}:`, e.message);
    }
  }

  // Test 1: Bridge Kit Initialization
  test("1. BridgeKit initializes cleanly", () => {
    const kit = new BridgeKit();
    assert(kit !== null && typeof kit.bridge === "function", "Kit must expose bridge method");
    assert(typeof kit.estimate === "function", "Kit must expose estimate method");
  });

  // Test 2: Arc & Base Chain Configuration
  test("2. Arc Mainnet & Base Mainnet match Circle specifications", () => {
    assert.strictEqual(Arc.chainId, 5042, "Arc chainId must be 5042");
    assert.strictEqual(Arc.cctp.domain, 26, "Arc CCTP domain must be 26");
    assert.strictEqual(Arc.usdcAddress.toLowerCase(), "0x3600000000000000000000000000000000000000".toLowerCase());
    assert.strictEqual(Arc.cctp.contracts.v2.tokenMessenger, "0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");

    assert.strictEqual(Base.chainId, 8453, "Base chainId must be 8453");
    assert.strictEqual(Base.cctp.domain, 6, "Base CCTP domain must be 6");
    assert.strictEqual(Base.usdcAddress.toLowerCase(), "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase());
  });

  // Test 3: Viem Adapter Instantiation
  test("3. ViemAdapter creates with user/developer capabilities", () => {
    const dummyKey = "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const adapter = createViemAdapterFromPrivateKey({ privateKey: dummyKey });
    assert(adapter !== null, "Adapter instance must be created");
    assert(typeof adapter.prepare === "function", "Adapter must have prepare method");
  });

  // Test 4: Route Discovery (Arc -> Base)
  await testAsync("4. BridgeKit finds CCTPV2 provider for Arc -> Base route", async () => {
    const kit = new BridgeKit();
    const provider = await kit.findProviderForRoute({
      source: { chain: Arc },
      destination: { chain: Base },
      token: "USDC"
    });
    assert(provider !== null, "Route must have an available bridging provider");
    assert.strictEqual(provider.constructor.name, "CCTPV2BridgingProvider", "Provider must be CCTPV2");
  });

  // Test 5: Standard Transfer Configuration
  test("5. Arc Mainnet only has Standard Transfer contracts (no tokenMessengerWithFees)", () => {
    assert.strictEqual(Arc.cctp.contracts.v2.tokenMessengerWithFees, undefined, "Arc must not have tokenMessengerWithFees");
    assert(Base.cctp.contracts.v2.tokenMessengerWithFees !== undefined, "Base has tokenMessengerWithFees");
  });

  // Test 6: Fast Transfer Enforcement Logic
  test("6. Fast Transfer is disbarred when source is Arc", () => {
    const { isFastTransferSupported } = require("../src/config/mainnet-chain-registry");
    const arcToBaseFast = isFastTransferSupported("Arc Mainnet", "Base Mainnet");
    assert.strictEqual(arcToBaseFast, false, "Arc -> Base MUST return false for Fast Transfer");
  });

  // Test 7: Unsupported Chain / Invalid Route Rejection
  await testAsync("7. BridgeKit throws on invalid / unsupported destination", async () => {
    const kit = new BridgeKit();
    let threw = false;
    try {
      await kit.findProviderForRoute({
        source: { chain: Arc },
        destination: { chain: { name: "NonExistentChain", chain: "Unknown" } },
        token: "USDC"
      });
    } catch (e) {
      threw = true;
    }
    assert(threw, "Invalid route must throw unsupported route error");
  });

  // Test 8: Mainnet Isolation Check
  test("8. Mainnet chains are isolated from Testnet list", () => {
    const { TESTNET_SUPPORTED_CHAINS, MAINNET_SUPPORTED_CHAINS, isMainnetChain, isTestnetChain } = require("../src/config/swap-contract");
    assert(!TESTNET_SUPPORTED_CHAINS.includes("Arc Mainnet"), "Testnet list must not contain Arc Mainnet");
    assert(!TESTNET_SUPPORTED_CHAINS.includes("Base Mainnet"), "Testnet list must not contain Base Mainnet");
    assert(isMainnetChain("Arc Mainnet"), "isMainnetChain must recognize Arc Mainnet");
    assert(isTestnetChain("Arc Testnet"), "isTestnetChain must recognize Arc Testnet");
  });

  console.log(`\n=== TEST RESULTS: ${passed}/${total} PASSED ===`);
  if (passed === total) {
    console.log("ALL TESTS COMPLETED SUCCESSFULLY!\n");
  } else {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

