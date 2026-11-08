/** Circle USDC on Solana mainnet. A published mint, not a value this program derives. */
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** CAIP-2 identifier x402 uses for Solana mainnet. */
export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** Full genesis hash from `getGenesisHash`. The CAIP-2 id is only the first 32 characters. */
export const SOLANA_MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";

export const RPC_URL = "https://api.mainnet-beta.solana.com";

/**
 * Probed 2026-11-08: GET returns 402, exact, Solana mainnet, USDC amount 5000.
 * The fee payer is whatever that 402 names. ~/Dev/bursar-solana-notes.md was
 * not on disk.
 */
export const LIVE_GET = "https://citable.run/v1/keyword-suggest?seed=solana&limit=3";

export const PER_PAYMENT_UI = "0.05";
export const SESSION_UI = "1";
export const USDC_DECIMALS = "6";

export const MODEL_URL = process.env.BURSAR_MODEL_URL ?? "http://localhost:8000/v1/chat/completions";
