import { CCTP_MAINNET_CONFIG, dryRunArcToBaseCctp } from "../lib/bridge/cctp-mainnet-client";
import { padHex } from "viem";

describe("Circle CCTP V2 Mainnet Backend Architecture", () => {
  it("has strictly verified contract addresses and domain IDs matching Circle docs", () => {
    // Arc Mainnet
    expect(CCTP_MAINNET_CONFIG.arc.domain).toBe(26);
    expect(CCTP_MAINNET_CONFIG.arc.chainId).toBe(5042);
    expect(CCTP_MAINNET_CONFIG.arc.usdc).toBe("0x3600000000000000000000000000000000000000");
    expect(CCTP_MAINNET_CONFIG.arc.tokenMessengerV2).toBe("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");
    expect(CCTP_MAINNET_CONFIG.arc.messageTransmitterV2).toBe("0x81D40F21F12A8F0E3252Bccb954D722d4c464B64");

    // Base Mainnet
    expect(CCTP_MAINNET_CONFIG.base.domain).toBe(6);
    expect(CCTP_MAINNET_CONFIG.base.chainId).toBe(8453);
    expect(CCTP_MAINNET_CONFIG.base.usdc).toBe("0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
    expect(CCTP_MAINNET_CONFIG.base.tokenMessengerV2).toBe("0x28b5a0e9C621a5BadaA536219b3a228C8168cf5d");
    expect(CCTP_MAINNET_CONFIG.base.messageTransmitterV2).toBe("0x81D40F21F12A8F0E3252Bccb954D722d4c464B64");
  });

  it("encodes 32-byte destination recipient correctly for CCTP V2 burn", () => {
    const evmAddress = "0xe2ED006Dbb1726e0f577733F65d30a94D34bDD77";
    const padded = padHex(evmAddress, { size: 32 });

    expect(padded.length).toBe(66); // '0x' + 64 hex characters (32 bytes)
    expect(padded.toLowerCase()).toBe("0x000000000000000000000000e2ed006dbb1726e0f577733f65d30a94d34bdd77");
  });

  it("rejects invalid destination recipient addresses during dry-run", async () => {
    await expect(
      dryRunArcToBaseCctp({
        privateKey: "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        recipientAddress: "not-an-address",
        amountUSDC: "1.0",
      })
    ).rejects.toThrow("Invalid destination recipient address");
  });
});

