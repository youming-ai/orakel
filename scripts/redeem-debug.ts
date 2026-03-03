import { connectWallet, getWallet, getWalletAddress } from "../src/trading/trader.ts";
import { fetchRedeemablePositions, redeemAll } from "../src/blockchain/redeemer.ts";
import { env } from "../src/core/env.ts";

async function main() {
	if (!env.PRIVATE_KEY) {
		console.error("PRIVATE_KEY not set in .env");
		process.exit(1);
	}

	const { address } = await connectWallet(env.PRIVATE_KEY);
	console.log(`Wallet connected: ${address}\n`);

	const wallet = getWallet();
	if (!wallet) {
		console.error("Failed to get wallet instance");
		process.exit(1);
	}

	console.log(`Wallet address from getWallet(): ${wallet.address}`);
	console.log(`Wallet address from getWalletAddress(): ${getWalletAddress()}`);

	// First, just fetch positions
	console.log("\nFetching redeemable positions...");
	const positions = await fetchRedeemablePositions(wallet.address);
	console.log(`Found ${positions.length} redeemable positions`);

	if (positions.length === 0) {
		console.log("No positions found - checking wallet address case sensitivity...");
		console.log(`Lowercase: ${wallet.address.toLowerCase()}`);
	}

	for (const pos of positions) {
		console.log(`\nPosition:`);
		console.log(`  Title: ${pos.title}`);
		console.log(`  Condition ID: ${pos.conditionId}`);
		console.log(`  Value: $${pos.currentValue}`);
		console.log(`  Redeemable: ${pos.redeemable}`);
	}

	// Then redeem
	console.log("\nStarting redemption...");
	const results = await redeemAll(wallet);
	console.log(`\nRedeem results: ${results.length} items`);

	for (const result of results) {
		console.log(JSON.stringify(result, null, 2));
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
