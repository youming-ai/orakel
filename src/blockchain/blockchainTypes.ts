export interface OnChainEvent {
	type: "usdc_transfer" | "ctf_transfer_single" | "ctf_transfer_batch";
	txHash: string;
	blockNumber: number;
	logIndex: number;
	from: string;
	to: string;
	tokenId: string | null;
	value: string;
	timestamp: number;
}

export type ReconStatus = "unreconciled" | "pending" | "confirmed" | "disputed";

export interface ReconResult {
	orderId: string;
	status: ReconStatus;
	confidence: number;
	txHash: string | null;
	blockNumber: number | null;
}
