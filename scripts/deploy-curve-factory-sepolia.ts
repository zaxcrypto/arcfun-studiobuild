import { ethers } from "hardhat";

async function main() {
  console.log("--------------------------------------------------");
  console.log("Deploying ArcFunCurveFactory to Ethereum Sepolia...");
  console.log("--------------------------------------------------");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer address:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Deployer balance:", ethers.formatEther(balance), "ETH");

  const FactoryContract = await ethers.getContractFactory("ArcFunCurveFactory");
  const factory = await FactoryContract.deploy(deployer.address);
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  const txHash = factory.deploymentTransaction()?.hash;

  console.log("ArcFunCurveFactory successfully deployed!");
  console.log("Factory Address:", factoryAddress);
  console.log("Transaction Hash:", txHash);
  console.log("Default Whitelisted Quote (NVDA):", await factory.DEFAULT_SEPOLIA_NVDA());
  console.log("Is NVDA Approved?", await factory.isApprovedQuote(await factory.DEFAULT_SEPOLIA_NVDA()));
  console.log("--------------------------------------------------");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
