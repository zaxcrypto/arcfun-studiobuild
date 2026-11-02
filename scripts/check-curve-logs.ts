import { ethers } from "hardhat";

async function main() {
  const curveAddr = "0x74a3048E73C80D447c217960409fBC311a8f7B78";
  const curve = await ethers.getContractAt("ArcFunBondingCurve", curveAddr);
  const currentBlock = await ethers.provider.getBlockNumber();
  const buyEvents = await curve.queryFilter(curve.filters.Buy(), 0, "latest").catch(async () => {
    return curve.queryFilter(curve.filters.Buy(), currentBlock - 100000, "latest");
  });

  for (const e of buyEvents) {
    console.log(`Buy Event at block ${e.blockNumber}, txHash=${e.transactionHash}`);
  }
}

main().catch(console.error);
