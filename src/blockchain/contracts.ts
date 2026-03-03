import { ethers } from "ethers";

// === Contract Addresses (Polygon Mainnet) ===
export const CTF_ADDRESS = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045";
export const USDC_E_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";

// === CTF (Conditional Token Framework) — ERC1155 ===
export const CTF_ABI = [
	// Redemption
	"function redeemPositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] indexSets)",
	"function payoutDenominator(bytes32 conditionId) view returns (uint256)",
	// Balance queries
	"function balanceOf(address account, uint256 id) view returns (uint256)",
	"function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])",
	// Events
	"event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
	"event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)",
];

// === USDC.e — ERC20 ===
export const USDC_E_ABI = [
	"function balanceOf(address account) view returns (uint256)",
	"function decimals() view returns (uint8)",
	"event Transfer(address indexed from, address indexed to, uint256 value)",
];

// === Pre-computed Event Topic Hashes ===
export const TRANSFER_TOPIC = ethers.utils.id("Transfer(address,address,uint256)");
export const TRANSFER_SINGLE_TOPIC = ethers.utils.id("TransferSingle(address,address,address,uint256,uint256)");
export const TRANSFER_BATCH_TOPIC = ethers.utils.id("TransferBatch(address,address,address,uint256[],uint256[])");

// === ABI Interfaces (for encoding/decoding) ===
export const ctfIface = new ethers.utils.Interface(CTF_ABI);
export const usdcIface = new ethers.utils.Interface(USDC_E_ABI);

// === USDC.e Decimals ===
export const USDC_E_DECIMALS = 6;
