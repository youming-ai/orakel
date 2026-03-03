import { connectWallet, getWallet } from "../src/trading/trader.ts";
import { Contract, constants, ethers, Wallet } from "ethers";
import { env } from "../src/core/env.ts";
import { CTF_ABI, CTF_ADDRESS, USDC_E_ADDRESS } from "../src/blockchain/contracts.ts";

const GAS_OVERRIDES = {
	maxPriorityFeePerGas: 30_000_000_000,
	maxFeePerGas: 200_000_000_000,
};

async function main() {
	if (!env.PRIVATE_KEY) {
		console.error("PRIVATE_KEY not set in .env");
		process.exit(1);
	}

	const { address } = await connectWallet(env.PRIVATE_KEY);
	console.log(`Wallet: ${address}\n`);

	const wallet = getWallet();
	if (!wallet) {
		console.error("Failed to get wallet instance");
		process.exit(1);
	}

	// Condition ID for XRP 8:30AM-8:45AM ET
	const conditionId = "0x6bd667619447f5e983545dbda49740ed7ef94eb28fcfd40292b42eb9fa891d7d";
	const expectedValue = 5;

	console.log(`Redeeming position:`);
	console.log(`  Condition ID: ${conditionId}`);
	console.log(`  Expected value: $${expectedValue}\n`);

	// Check if already redeemed
	const ctf = new Contract(CTF_ADDRESS, CTF_ABI, wallet);

	const denominator = await ctf.payoutDenominator(conditionId);
	console.log(`Payout denominator: ${denominator.toString()}`);

	if (denominator.isZero()) {
		console.log("\n⚠️  Position already redeemed or not settled yet");
		process.exit(1);
	}

	// Execute redemption
	console.log("\n⏳ Sending redemption transaction...");
	const tx = await ctf.redeemPositions(
		USDC_E_ADDRESS,
		constants.HashZero,
		conditionId,
		[1, 2],
		GAS_OVERRIDES,
	);

	console.log(`📝 Transaction sent: ${tx.hash}`);
	console.log("⏳ Waiting for confirmation...");

	try {
		const receipt = await Promise.race([
			tx.wait(),
			new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout after 60s")), 60_000)),
		]);

		if (receipt && typeof receipt === "object" && "status" in receipt) {
			if (receipt.status === 1) {
				console.log("\n✅ Redemption successful!");
				console.log(`   TX Hash: ${tx.hash}`);
				console.log(`   Block: ${receipt.blockNumber}`);
				console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
			} else {
				console.log("\n❌ Transaction reverted");
				process.exit(1);
			}
		}
	} catch (err) {
		console.error("\n❌ Transaction failed or timed out:", err);
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
