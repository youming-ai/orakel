import { connectWallet } from "../src/trading/trader.ts";
import { env } from "../src/core/env.ts";
import { USDC_E_ADDRESS } from "../src/blockchain/contracts.ts";
import { ethers } from "ethers";

const USDC_ABI = [
	"function balanceOf(address owner) view returns (uint256)",
	"function decimals() view returns (uint8)",
];

async function main() {
	if (!env.PRIVATE_KEY) {
		console.error("PRIVATE_KEY not set in .env");
		process.exit(1);
	}

	const { address } = await connectWallet(env.PRIVATE_KEY);
	console.log(`Wallet: ${address}\n`);

	const provider = new ethers.JsonRpcProvider(env.POLYGON_RPC_URL);
	const usdc = new ethers.Contract(USDC_E_ADDRESS, USDC_ABI, provider);

	const balance = await usdc.balanceOf(address);
	const decimals = await usdc.decimals();
	const balanceFormatted = Number(balance) / 10 ** decimals;

	console.log(`USDC-e Balance: $${balanceFormatted.toFixed(2)}`);
}

main().catch(console.error);
