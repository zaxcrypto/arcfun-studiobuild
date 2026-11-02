import { expect } from "chai";
import { ethers } from "hardhat";
import { ArcFunCurveFactory, ArcFunBondingCurve, ArcFunMemeToken, SimpleERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("Stage 2.5: Deep Adversarial & Financial Hardening Test Suite", function () {
  let owner: SignerWithAddress;
  let creator: SignerWithAddress;
  let trader1: SignerWithAddress;
  let trader2: SignerWithAddress;
  let trader3: SignerWithAddress;
  let attacker: SignerWithAddress;

  let factory: ArcFunCurveFactory;
  let mockNvda: SimpleERC20;
  let memeToken: ArcFunMemeToken;
  let bondingCurve: ArcFunBondingCurve;

  const GRADUATION_TARGET = ethers.parseEther("41.6");
  const SALE_SUPPLY = ethers.parseEther("800000000");
  const DEX_ALLOCATION = ethers.parseEther("200000000");

  beforeEach(async function () {
    [owner, creator, trader1, trader2, trader3, attacker] = await ethers.getSigners();

    // 1. Deploy Mock NVDA dShare
    const ERC20FactoryContract = await ethers.getContractFactory("SimpleERC20");
    mockNvda = await ERC20FactoryContract.deploy(
      "NVIDIA Corporation - Dinari",
      "NVDA",
      ethers.parseEther("100000"),
      owner.address
    );
    await mockNvda.waitForDeployment();

    // Distribute funds
    for (const trader of [trader1, trader2, trader3, attacker]) {
      await mockNvda.transfer(trader.address, ethers.parseEther("1000"));
    }

    // 2. Deploy Factory
    const FactoryContract = await ethers.getContractFactory("ArcFunCurveFactory");
    factory = await FactoryContract.deploy(owner.address);
    await factory.waitForDeployment();
    await factory.setQuoteAssetWhitelist(await mockNvda.getAddress(), true);

    // 3. Launch Meme Token + Curve
    const tx = await factory.connect(creator).createLaunch(
      "Adversarial Meme",
      "ADV",
      await mockNvda.getAddress()
    );
    const receipt = await tx.wait();

    const launchEvent = receipt?.logs
      .map((log: any) => {
        try {
          return factory.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((e: any) => e?.name === "LaunchCreated");

    memeToken = await ethers.getContractAt("ArcFunMemeToken", launchEvent?.args?.token);
    bondingCurve = await ethers.getContractAt("ArcFunBondingCurve", launchEvent?.args?.curve);
  });

  describe("1. Rounding & 1-Wei Precision Edge Cases", function () {
    it("Should safely handle 1-wei buy without division by zero or underpayment", async function () {
      const oneWei = 1n;
      await mockNvda.connect(trader1).approve(await bondingCurve.getAddress(), oneWei);
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;

      const [expectedTokens] = await bondingCurve.getBuyQuote(oneWei);
      expect(expectedTokens).to.be.gt(0n);

      await expect(
        bondingCurve.connect(trader1).buy(oneWei, expectedTokens, trader1.address, deadline)
      ).to.emit(bondingCurve, "Buy");

      // Verify solvency invariant: real quote balance in contract >= realQuoteReserve
      const quoteBal = await mockNvda.balanceOf(await bondingCurve.getAddress());
      const rQuote = await bondingCurve.realQuoteReserve();
      expect(quoteBal).to.be.gte(rQuote);
    });

    it("Should safely handle 1-wei sell without reverting or draining reserves", async function () {
      // Buy first
      await mockNvda.connect(trader1).approve(await bondingCurve.getAddress(), ethers.parseEther("1"));
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      await bondingCurve.connect(trader1).buy(ethers.parseEther("1"), 1n, trader1.address, deadline);

      const oneWei = 1n;
      await memeToken.connect(trader1).approve(await bondingCurve.getAddress(), oneWei);

      const [expectedQuote] = await bondingCurve.getSellQuote(oneWei);
      await bondingCurve.connect(trader1).sell(oneWei, expectedQuote, trader1.address, deadline);

      const quoteBal = await mockNvda.balanceOf(await bondingCurve.getAddress());
      const rQuote = await bondingCurve.realQuoteReserve();
      expect(quoteBal).to.be.gte(rQuote);
    });
  });

  describe("2. Randomized Buy/Sell Sequences & Solvency Invariant Fuzzing", function () {
    it("Should maintain absolute solvency through 30 randomized buy and sell transactions", async function () {
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      const traders = [trader1, trader2, trader3];

      for (let i = 0; i < 30; i++) {
        const trader = traders[i % traders.length];
        const isBuy = Math.random() > 0.35; // 65% buys, 35% sells

        if (isBuy) {
          // Random buy between 0.1 and 1.5 NVDA
          const randomAmount = ethers.parseEther((0.1 + Math.random() * 1.4).toFixed(4));
          const currentRealQuote = await bondingCurve.realQuoteReserve();

          if (currentRealQuote + randomAmount < GRADUATION_TARGET) {
            await mockNvda.connect(trader).approve(await bondingCurve.getAddress(), randomAmount);
            const [expectedTokens] = await bondingCurve.getBuyQuote(randomAmount);
            await bondingCurve.connect(trader).buy(randomAmount, (expectedTokens * 90n) / 100n, trader.address, deadline);
          }
        } else {
          // Sell random portion of tokens owned
          const memeBal = await memeToken.balanceOf(trader.address);
          if (memeBal > ethers.parseEther("1000")) {
            const sellAmount = memeBal / 3n;
            await memeToken.connect(trader).approve(await bondingCurve.getAddress(), sellAmount);
            const [expectedQuote] = await bondingCurve.getSellQuote(sellAmount);
            await bondingCurve.connect(trader).sell(sellAmount, (expectedQuote * 90n) / 100n, trader.address, deadline);
          }
        }

        // Strict Invariant Check after EVERY trade:
        const contractNvdaBal = await mockNvda.balanceOf(await bondingCurve.getAddress());
        const contractMemeBal = await memeToken.balanceOf(await bondingCurve.getAddress());
        const realQuote = await bondingCurve.realQuoteReserve();
        const tokensSold = await bondingCurve.realTokenSold();

        // 1. Curve real quote balance must NEVER be less than realQuoteReserve
        expect(contractNvdaBal).to.be.gte(realQuote, `Solvency broken on step ${i}`);

        // 2. Token inventory must strictly equal (SALE_SUPPLY - tokensSold) + DEX_ALLOCATION
        const expectedMemeHolding = SALE_SUPPLY - tokensSold + DEX_ALLOCATION;
        expect(contractMemeBal).to.equal(expectedMemeHolding, `Token inventory broken on step ${i}`);
      }
    });
  });

  describe("3. Oversized Buy at Graduation Boundary (Exact Partial Execution)", function () {
    it("Should only pull the exact quote needed to graduate if user submits an oversized buy", async function () {
      // 1. Buy 40.0 NVDA first (close to 41.6 NVDA threshold)
      const initialBuy = ethers.parseEther("40.0");
      await mockNvda.connect(trader1).approve(await bondingCurve.getAddress(), initialBuy);
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      await bondingCurve.connect(trader1).buy(initialBuy, 1n, trader1.address, deadline);

      expect(await bondingCurve.realQuoteReserve()).to.equal(initialBuy);
      const remainingNeeded = GRADUATION_TARGET - initialBuy; // 1.6 NVDA

      // 2. Trader 2 attempts to buy with 10.0 NVDA (much more than 1.6 NVDA remaining)
      const excessBuy = ethers.parseEther("10.0");
      await mockNvda.connect(trader2).approve(await bondingCurve.getAddress(), excessBuy);

      const trader2NvdaBefore = await mockNvda.balanceOf(trader2.address);
      const [expectedTokens, newQuote] = await bondingCurve.getBuyQuote(excessBuy);

      expect(newQuote).to.equal(GRADUATION_TARGET);

      const tx = await bondingCurve.connect(trader2).buy(excessBuy, expectedTokens, trader2.address, deadline);
      await tx.wait();

      const trader2NvdaAfter = await mockNvda.balanceOf(trader2.address);
      const actualDeducted = trader2NvdaBefore - trader2NvdaAfter;

      // CRITICAL CHECK: Trader 2 must only have been charged 1.6 NVDA, NOT 10 NVDA!
      expect(actualDeducted).to.equal(remainingNeeded);
      expect(await bondingCurve.realQuoteReserve()).to.equal(GRADUATION_TARGET);
      expect(await bondingCurve.state()).to.equal(1); // GRADUATED
    });
  });

  describe("4. Post-Graduation Trading Freeze & Security Invariants", function () {
    it("Should permanently reject buys and sells once graduated", async function () {
      // Graduate the curve
      await mockNvda.connect(trader1).approve(await bondingCurve.getAddress(), GRADUATION_TARGET);
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      await bondingCurve.connect(trader1).buy(GRADUATION_TARGET, 1n, trader1.address, deadline);

      expect(await bondingCurve.state()).to.equal(1);

      // Attempt buy
      await mockNvda.connect(trader2).approve(await bondingCurve.getAddress(), ethers.parseEther("1"));
      await expect(
        bondingCurve.connect(trader2).buy(ethers.parseEther("1"), 1n, trader2.address, deadline)
      ).to.be.revertedWith("CURVE_NOT_ACTIVE");

      // Attempt sell
      const memeBal = await memeToken.balanceOf(trader1.address);
      await memeToken.connect(trader1).approve(await bondingCurve.getAddress(), memeBal);
      await expect(
        bondingCurve.connect(trader1).sell(memeBal, 1n, trader1.address, deadline)
      ).to.be.revertedWith("CURVE_NOT_ACTIVE");
    });

    it("Should prevent unauthorized re-initialization of meme token", async function () {
      await expect(
        bondingCurve.connect(attacker).initialize(attacker.address)
      ).to.be.revertedWith("ONLY_FACTORY");
    });
  });
});
