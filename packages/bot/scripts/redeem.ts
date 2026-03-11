import { connectWallet, getWallet } from "../src/trading/trader.ts";
import { redeemAll } from "../src/blockchain/redeemer.ts";
import { env } from "../src/core/env.ts";

async function main() {
	// Connect wallet using PRIVATE_KEY from env
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

	console.log("Starting redemption process...\n");
	console.log("This will:");
	console.log("  1. Fetch all redeemable positions from Polymarket");
	console.log("  2. Submit on-chain redemption transactions");
	console.log("  3. Wait for transaction confirmation (may take ~60s each)\n");

	const results = await redeemAll(wallet);

	console.log("\n=== Redemption Results ===");
	let successCount = 0;
	let totalValue = 0;

	for (const result of results) {
		if (result.error) {
			console.log(`❌ ${result.conditionId.slice(0, 10)}...: ${result.error}`);
		} else {
			successCount++;
			console.log(`✅ ${result.conditionId.slice(0, 10)}...`);
			console.log(`   TX: ${result.txHash}`);
			if (result.value !== undefined) {
				console.log(`   Value: $${result.value.toFixed(2)}`);
				totalValue += result.value;
			}
			if (result.status) {
				console.log(`   Status: ${result.status}`);
			}
		}
	}

	console.log(`\n📊 Summary:`);
	console.log(`   Total redeemed: ${successCount}/${results.length}`);
	if (totalValue > 0) {
		console.log(`   Total value: $${totalValue.toFixed(2)}`);
	}

	if (successCount === 0) {
		console.log("\n⚠️  No positions were redeemed");
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
