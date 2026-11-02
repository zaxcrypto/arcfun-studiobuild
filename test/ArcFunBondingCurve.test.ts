import { expect } from "chai";
import { ethers } from "hardhat";
import { ArcFunCurveFactory, ArcFunBondingCurve, ArcFunMemeToken, SimpleERC20 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("ArcFun Bonding Curve Financial & Economic Engine (Stage 2)", function () {
  let owner: SignerWithAddress;
  let creator: SignerWithAddress;
  let buyer1: SignerWithAddress;
  let buyer2: SignerWithAddress;
  let seller: SignerWithAddress;

  let factory: ArcFunCurveFactory;
  let mockNvda: SimpleERC20;
  let memeToken: ArcFunMemeToken;
  let bondingCurve: ArcFunBondingCurve;

  const ONE_ETH = ethers.parseEther("1");
  const TOTAL_SUPPLY = ethers.parseEther("1000000000"); // 1B
  const SALE_SUPPLY = ethers.parseEther("800000000");   // 800M
  const DEX_ALLOCATION = ethers.parseEther("200000000"); // 200M
  const GRADUATION_TARGET = ethers.parseEther("41.6");  // 41.6 NVDA

  beforeEach(async function () {
    [owner, creator, buyer1, buyer2, seller] = await ethers.getSigners();

    // 1. Deploy Mock NVDA dShare (18 decimals)
    const ERC20FactoryContract = await ethers.getContractFactory("SimpleERC20");
    mockNvda = await ERC20FactoryContract.deploy(
      "NVIDIA Corporation - Dinari",
      "NVDA",
      ethers.parseEther("10000"),
      owner.address
    );
    await mockNvda.waitForDeployment();

    // Distribute Mock NVDA to test accounts
    await mockNvda.transfer(buyer1.address, ethers.parseEther("100"));
    await mockNvda.transfer(buyer2.address, ethers.parseEther("100"));
    await mockNvda.transfer(creator.address, ethers.parseEther("100"));

    // 2. Deploy ArcFunCurveFactory
    const FactoryContract = await ethers.getContractFactory("ArcFunCurveFactory");
    factory = await FactoryContract.deploy(owner.address);
    await factory.waitForDeployment();

    // Whitelist mockNvda
    await factory.setQuoteAssetWhitelist(await mockNvda.getAddress(), true);

    // 3. Deploy Test Meme Token + Bonding Curve
    const tx = await factory.connect(creator).createLaunch(
      "Test NVDA Meme",
      "TNVDA",
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

    const tokenAddress = launchEvent?.args?.token;
    const curveAddress = launchEvent?.args?.curve;

    memeToken = await ethers.getContractAt("ArcFunMemeToken", tokenAddress);
    bondingCurve = await ethers.getContractAt("ArcFunBondingCurve", curveAddress);
  });

  describe("1. Factory & Initialization Invariants", function () {
    it("Should properly initialize token with 1B supply minted 100% to curve", async function () {
      expect(await memeToken.totalSupply()).to.equal(TOTAL_SUPPLY);
      expect(await memeToken.balanceOf(await bondingCurve.getAddress())).to.equal(TOTAL_SUPPLY);
      expect(await memeToken.balanceOf(creator.address)).to.equal(0n);
      expect(await bondingCurve.isInitialized()).to.be.true;
    });

    it("Should record curve link in factory mapping", async function () {
      expect(await factory.getCurve(await memeToken.getAddress())).to.equal(await bondingCurve.getAddress());
      expect(await factory.totalLaunches()).to.equal(1n);
    });

    it("Should reject unapproved quote assets", async function () {
      const FakeToken = await ethers.getContractFactory("SimpleERC20");
      const fake = await FakeToken.deploy("Fake Stock", "FAKE", ethers.parseEther("1000"), owner.address);
      await fake.waitForDeployment();

      await expect(
        factory.connect(creator).createLaunch("Fake Meme", "FMEME", await fake.getAddress())
      ).to.be.revertedWith("QUOTE_ASSET_NOT_APPROVED");
    });
  });

  describe("2. Pricing Math & Initial Reserves", function () {
    it("Should correctly compute initial spot price of 1.04e-8 NVDA/MEME", async function () {
      const price = await bondingCurve.getCurrentPrice();
      // P = (10.4 * 1e18 * 1e18) / 1e27 = 10,400,000,000 wei (1.04e-8 NVDA)
      expect(price).to.equal(10_400_000_000n);
    });

    it("Should return correct real and virtual reserves", async function () {
      const [vQuote, vToken] = await bondingCurve.getVirtualReserves();
      expect(vQuote).to.equal(ethers.parseEther("10.4"));
      expect(vToken).to.equal(TOTAL_SUPPLY);

      const [rQuote, remainingSale, dexTokens] = await bondingCurve.getRealReserves();
      expect(rQuote).to.equal(0n);
      expect(remainingSale).to.equal(SALE_SUPPLY);
      expect(dexTokens).to.equal(DEX_ALLOCATION);
    });
  });

  describe("3. Buy Transactions & Slippage Protection", function () {
    it("Should execute 1 NVDA buy correctly and transfer tokens to buyer", async function () {
      const quoteIn = ethers.parseEther("1.0");
      const [expectedTokens, newRealQuote, newTokensSold] = await bondingCurve.getBuyQuote(quoteIn);

      // Approve NVDA to curve
      await mockNvda.connect(buyer1).approve(await bondingCurve.getAddress(), quoteIn);

      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      await expect(bondingCurve.connect(buyer1).buy(quoteIn, expectedTokens, buyer1.address, deadline))
        .to.emit(bondingCurve, "Buy");

      expect(await memeToken.balanceOf(buyer1.address)).to.equal(expectedTokens);
      expect(await mockNvda.balanceOf(await bondingCurve.getAddress())).to.equal(quoteIn);
      expect(await bondingCurve.realQuoteReserve()).to.equal(quoteIn);
      expect(await bondingCurve.realTokenSold()).to.equal(expectedTokens);
    });

    it("Should revert if tokensOut < minTokensOut (Slippage guard)", async function () {
      const quoteIn = ethers.parseEther("1.0");
      const [expectedTokens] = await bondingCurve.getBuyQuote(quoteIn);

      await mockNvda.connect(buyer1).approve(await bondingCurve.getAddress(), quoteIn);
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;

      // Ask for more than calculated
      await expect(
        bondingCurve.connect(buyer1).buy(quoteIn, expectedTokens + 1000n, buyer1.address, deadline)
      ).to.be.revertedWith("SLIPPAGE_EXCEEDED");
    });

    it("Should revert if transaction expired", async function () {
      const quoteIn = ethers.parseEther("1.0");
      await mockNvda.connect(buyer1).approve(await bondingCurve.getAddress(), quoteIn);
      const pastDeadline = 1; // Expired timestamp

      await expect(
        bondingCurve.connect(buyer1).buy(quoteIn, 1n, buyer1.address, pastDeadline)
      ).to.be.revertedWith("TRANSACTION_EXPIRED");
    });
  });

  describe("4. Sell Transactions & Rounding Solvency", function () {
    beforeEach(async function () {
      // Buyer1 buys 5 NVDA worth of meme tokens first
      const quoteIn = ethers.parseEther("5.0");
      await mockNvda.connect(buyer1).approve(await bondingCurve.getAddress(), quoteIn);
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      await bondingCurve.connect(buyer1).buy(quoteIn, 1n, buyer1.address, deadline);
    });

    it("Should execute partial sell and refund quote to seller", async function () {
      const tokensToSell = ethers.parseEther("10000000"); // 10M tokens
      const [expectedQuoteOut] = await bondingCurve.getSellQuote(tokensToSell);

      const balBefore = await mockNvda.balanceOf(buyer1.address);
      await memeToken.connect(buyer1).approve(await bondingCurve.getAddress(), tokensToSell);

      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      await bondingCurve.connect(buyer1).sell(tokensToSell, expectedQuoteOut, buyer1.address, deadline);

      const balAfter = await mockNvda.balanceOf(buyer1.address);
      expect(balAfter - balBefore).to.equal(expectedQuoteOut);
    });

    it("Should maintain real quote solvency after sell (balance >= r)", async function () {
      const userTokens = await memeToken.balanceOf(buyer1.address);
      await memeToken.connect(buyer1).approve(await bondingCurve.getAddress(), userTokens);

      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      await bondingCurve.connect(buyer1).sell(userTokens, 1n, buyer1.address, deadline);

      const curveQuoteBal = await mockNvda.balanceOf(await bondingCurve.getAddress());
      const curveRealQuote = await bondingCurve.realQuoteReserve();

      expect(curveQuoteBal).to.be.gte(curveRealQuote);
    });
  });

  describe("5. Graduation Threshold & Boundary Conditions", function () {
    it("Should graduate when real quote reserve hits 41.6 NVDA and lock further curve trading", async function () {
      // Buy exactly 41.6 NVDA
      const quoteIn = GRADUATION_TARGET;
      await mockNvda.transfer(buyer2.address, ethers.parseEther("100"));
      await mockNvda.connect(buyer2).approve(await bondingCurve.getAddress(), quoteIn);

      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      await expect(bondingCurve.connect(buyer2).buy(quoteIn, 1n, buyer2.address, deadline))
        .to.emit(bondingCurve, "Graduated");

      expect(await bondingCurve.state()).to.equal(1); // GRADUATED
      expect(await bondingCurve.getCurveProgress()).to.equal(10_000n); // 100%

      // Verify reserves at graduation:
      // Real quote = 41.6 NVDA
      expect(await bondingCurve.realQuoteReserve()).to.equal(GRADUATION_TARGET);
      // All 800M tokens sold
      expect(await bondingCurve.realTokenSold()).to.equal(SALE_SUPPLY);
      // Curve still safely holds 200M DEX allocation
      expect(await memeToken.balanceOf(await bondingCurve.getAddress())).to.equal(DEX_ALLOCATION);

      // Attempting further buy or sell must revert
      await mockNvda.connect(buyer2).approve(await bondingCurve.getAddress(), ethers.parseEther("1"));
      await expect(
        bondingCurve.connect(buyer2).buy(ethers.parseEther("1"), 1n, buyer2.address, deadline)
      ).to.be.revertedWith("CURVE_NOT_ACTIVE");
    });
  });

  describe("6. Economic Simulation Report", function () {
    it("Outputs rigorous milestone progression simulation", async function () {
      console.log("\n==================================================================================");
      console.log("       ARCFUN BONDING CURVE ECONOMIC SIMULATION (41.6 NVDA GRADUATION TARGET)");
      console.log("==================================================================================");
      console.log("Cumulative Quote | Tokens Sold (MEME) | Remaining Sale | Spot Price (NVDA) | FDV (NVDA) | Progress");
      console.log("----------------------------------------------------------------------------------");

      const milestones = [0, 1, 5, 10, 20, 30, 40, 41.6];
      for (const m of milestones) {
        if (m === 0) {
          const price = await bondingCurve.getCurrentPrice();
          console.log(
            `0.00 NVDA        | 0 MEME             | 800,000,000    | ${ethers.formatUnits(price, 18)} | 10.40      | 0.00%`
          );
        } else {
          const quoteWei = ethers.parseEther(m.toString());
          const [tokensOut, newQuote, newTokensSold, postPrice] = await bondingCurve.getBuyQuote(quoteWei);
          const remaining = (SALE_SUPPLY - newTokensSold) / 10n**18n;
          const soldFormatted = (newTokensSold / 10n**18n).toLocaleString();
          const fdv = (TOTAL_SUPPLY * postPrice) / 10n**36n;
          const progress = ((m / 41.6) * 100).toFixed(2);
          console.log(
            `${m.toFixed(2)} NVDA`.padEnd(17) +
            `| ${soldFormatted} MEME`.padEnd(21) +
            `| ${remaining.toString().padEnd(15)}` +
            `| ${ethers.formatUnits(postPrice, 18).slice(0, 10)}      ` +
            `| ${fdv.toString().slice(0, 6)}      ` +
            `| ${progress}%`
          );
        }
      }
      console.log("==================================================================================\n");
    });
  });
});
