interface DashboardData {
	slug: string;
	state: string;
	timeLeft: number;
	price: number;
	priceToBeat: number;
	deviation: number;
	modelProbUp: number;
	marketProbUp: number;
	edge: number;
	phase: string;
	paperPnl: number;
}

export function renderDashboard(data: DashboardData): void {
	const lines = [
		"=== BTC 5-Min Bot ===",
		`Window: ${data.slug} | State: ${data.state} | Phase: ${data.phase}`,
		`Time Left: ${data.timeLeft}s`,
		`BTC: $${data.price.toFixed(2)} | PtB: $${data.priceToBeat.toFixed(2)} | Dev: ${(data.deviation * 100).toFixed(3)}%`,
		`Model P(Up): ${(data.modelProbUp * 100).toFixed(1)}% | Market: ${(data.marketProbUp * 100).toFixed(1)}%`,
		`Edge: ${(data.edge * 100).toFixed(2)}%`,
		`Paper P&L: $${data.paperPnl.toFixed(2)}`,
		"=====================",
	];
	// biome-ignore lint/suspicious/noConsole: terminal dashboard is authorized console use
	console.clear();
	for (const line of lines) {
		// biome-ignore lint/suspicious/noConsole: terminal dashboard
		console.log(line);
	}
}
