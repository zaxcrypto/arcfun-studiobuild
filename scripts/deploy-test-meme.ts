import { ethers } from "hardhat";

async function main() {
  console.log("Deploying Test Meme Token on Ethereum Sepolia via ERC20Factory...");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer / Creator:", deployer.address);
  console.log("Network chainId:", (await ethers.provider.getNetwork()).chainId);

  const factoryAddress = "0x2293C131f398df7bfE13aD226006B49f0708a5E3";
  const factory = await ethers.getContractAt("ERC20Factory", factoryAddress);

  const tokenName = "Test NVDA Meme";
  const tokenSymbol = "TNVDAM";
  const initialSupply = ethers.parseUnits("1000000000", 18); // 1 Billion tokens

  console.log(`Calling factory.deployToken("${tokenName}", "${tokenSymbol}", ${initialSupply.toString()})...`);
  const tx = await factory.deployToken(tokenName, tokenSymbol, initialSupply);
  console.log("Tx sent:", tx.hash);

  const receipt = await tx.wait();
  console.log("Tx mined in block:", receipt?.blockNumber);

  // Parse TokenDeployed event
  let tokenAddress = "";
  for (const log of receipt?.logs || []) {
    try {
      const parsed = factory.interface.parseLog(log as any);
      if (parsed && parsed.name === "TokenDeployed") {
        tokenAddress = parsed.args[0];
        console.log("TokenDeployed event detected! Token address:", tokenAddress);
      }
    } catch {
      // not this event
    }
  }

  if (!tokenAddress) {
    throw new Error("Could not find TokenDeployed event");
  }

  // Verify on-chain properties
  const token = await ethers.getContractAt("SimpleERC20", tokenAddress);
  const onchainName = await token.name();
  const onchainSymbol = await token.symbol();
  const onchainDecimals = await token.decimals();
  const onchainTotalSupply = await token.totalSupply();
  const onchainDeployerBalance = await token.balanceOf(deployer.address);

  console.log("\n================ ON-CHAIN VALIDATION ================");
  console.log("Token Address:", tokenAddress);
  console.log("Name:", onchainName);
  console.log("Symbol:", onchainSymbol);
  console.log("Decimals:", onchainDecimals.toString());
  console.log("Total Supply:", ethers.formatUnits(onchainTotalSupply, onchainDecimals));
  console.log("Deployer Balance:", ethers.formatUnits(onchainDeployerBalance, onchainDecimals));
  console.log("TotalSupply == Balance:", onchainTotalSupply.toString() === onchainDeployerBalance.toString());
  console.log("=====================================================\n");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
