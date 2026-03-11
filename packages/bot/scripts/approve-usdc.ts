import { ethers } from "ethers";
import { env } from "../src/core/env.ts";
import { USDC_E_ADDRESS, USDC_E_DECIMALS } from "../src/blockchain/contracts.ts";

const POLYMARKET_SPENDER = "0x4D97DCd97eC9456b7a1207aFC95a0144e2E32E5a";
const APPROVE_AMOUNT = ethers.constants.MaxUint256;

async function main() {
	const privateKey = env.PRIVATE_KEY;
	if (!privateKey) {
		console.error("PRIVATE_KEY not found in environment");
		process.exit(1);
	}

	const provider = new ethers.providers.JsonRpcProvider("https://polygon-rpc.com");
	const wallet = new ethers.Wallet(privateKey, provider);

	console.log(`Wallet: ${wallet.address}`);
	console.log(`USDC: ${USDC_E_ADDRESS}`);
	console.log(`Spender: ${POLYMARKET_SPENDER}`);

	const usdcAbi = [
		"function approve(address spender, uint256 amount) returns (bool)",
		"function allowance(address owner, address spender) view returns (uint256)",
		"function balanceOf(address account) view returns (uint256)",
		"function decimals() view returns (uint8)",
	];

	const usdc = new ethers.Contract(USDC_E_ADDRESS, usdcAbi, wallet);

	const balance = await usdc.balanceOf(wallet.address);
	console.log(`\nBalance: ${ethers.utils.formatUnits(balance, USDC_E_DECIMALS)} USDC`);

	const currentAllowance = await usdc.allowance(wallet.address, POLYMARKET_SPENDER);
	console.log(`Allowance: ${ethers.utils.formatUnits(currentAllowance, USDC_E_DECIMALS)} USDC`);

	if (currentAllowance.gt(0)) {
		console.log("\n✓ Already approved");
		return;
	}

	console.log("\nApproving...");
	const tx = await usdc.approve(POLYMARKET_SPENDER, APPROVE_AMOUNT);
	console.log(`Tx: ${tx.hash}`);

	const receipt = await tx.wait();
	console.log(`✓ Approved! Block: ${receipt.blockNumber}`);

	const newAllowance = await usdc.allowance(wallet.address, POLYMARKET_SPENDER);
	console.log(`New Allowance: ${ethers.utils.formatUnits(newAllowance, USDC_E_DECIMALS)} USDC`);
}

main().catch((err) => {
	console.error("Error:", err);
	process.exit(1);
});
