import { resetPaperDbData, resetLiveDbData } from "../src/db/queries.ts";
import { closeDb } from "../src/db/client.ts";

async function main() {
	console.log("Resetting paper data...");
	await resetPaperDbData();
	console.log("✅ Paper data cleared");

	console.log("Resetting live data...");
	await resetLiveDbData();
	console.log("✅ Live data cleared");

	await closeDb();
	console.log("Done. Database is clean for fresh paper trading.");
}

main().catch((err) => {
	console.error("Reset failed:", err);
	process.exit(1);
});
