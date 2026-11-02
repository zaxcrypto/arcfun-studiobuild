import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { MAINNET_CHAIN_REGISTRY } from "../config/mainnet-chain-registry";
import { isMainnetChain, getSupportedChains, CHAIN_ID_MAP } from "../config/swap-contract";
import { getSolanaRpcUrl, getSolanaFallbackRpcUrl } from "../lib/solana-rpc";

describe("Solana Mainnet CCTP Integration Unit Tests", () => {
  it("should have correct Solana Mainnet metadata in MAINNET_CHAIN_REGISTRY", () => {
    const solana = MAINNET_CHAIN_REGISTRY["Solana Mainnet"];
    assert.ok(solana, "Solana Mainnet metadata should be defined");
    assert.equal(solana.domain, 5);
    assert.equal(solana.chainId, 101);
    assert.equal(solana.usdcAddress, "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    assert.equal(solana.tokenMessengerV2, "CCTPV2vPZJS2u2BBsUoscuikbYjnpFmbFsvVuJdgUMQe");
    assert.equal(solana.messageTransmitterV2, "CCTPV2Sm4AdWt5296sk4P66VBZ7bEhcARwFaaS9YPbeC");
    assert.equal(solana.status, "ACTIVE");
  });

  it("should identify Solana Mainnet as a mainnet chain", () => {
    assert.equal(isMainnetChain("Solana Mainnet"), true);
    assert.equal(isMainnetChain("Solana Devnet"), false);
  });

  it("should include Solana Mainnet in mainnet supported chains", () => {
    const mainnetChains = getSupportedChains("mainnet") as readonly string[];
    assert.ok(mainnetChains.includes("Solana Mainnet"), "Solana Mainnet must be in mainnet supported chains");
  });

  it("should map chain ID correctly for Solana", () => {
    assert.equal(CHAIN_ID_MAP["Solana Mainnet"], 101);
    assert.equal(CHAIN_ID_MAP["Solana Devnet"], 103);
  });

  it("should select the correct RPC URLs based on network mode", () => {
    const mainnetRpc = getSolanaRpcUrl(true);
    const devnetRpc = getSolanaRpcUrl(false);
    assert.ok(mainnetRpc.includes("solana-mainnet") || mainnetRpc.includes("mainnet"), "Mainnet RPC must target mainnet");
    assert.ok(devnetRpc.includes("devnet"), "Devnet RPC must target devnet");

    const fallbackMainnet = getSolanaFallbackRpcUrl(true);
    assert.equal(fallbackMainnet, "https://solana-rpc.publicnode.com");
  });

  it("should derive correct Solana Mainnet Associated Token Account (ATA)", () => {
    const sampleWallet = new PublicKey("4hx24EbF93ciMaY72MSn4iPYSJ6XX4EJ28CguXZWTRG7");
    const usdcMintMainnet = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    const tokenProgramId = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const ataProgramId = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

    const [ataPubKey] = PublicKey.findProgramAddressSync(
      [sampleWallet.toBuffer(), tokenProgramId.toBuffer(), usdcMintMainnet.toBuffer()],
      ataProgramId
    );

    assert.ok(ataPubKey, "ATA public key must be derived");
    assert.equal(PublicKey.isOnCurve(ataPubKey.toBuffer()), false, "ATA must be a PDA off-curve");
    
    // Verify conversion to 32-byte hex for CCTP mintRecipient
    const mintRecipientHex = "0x" + Buffer.from(ataPubKey.toBytes()).toString("hex");
    assert.equal(mintRecipientHex.length, 66, "mintRecipient must be exactly 66 chars (0x + 64 hex)");
    assert.ok(mintRecipientHex.startsWith("0x"));
  });
});
