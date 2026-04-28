/**
 * Owl Nesting + Solana RPC usage policy (low Helius / credit usage).
 *
 * - **No** wallet-wide token or NFT holder scans in nesting flows.
 * - **No** client or server polling loops; optional manual or cron "reconcile" uses a small bounded batch.
 * - **Do** use a single `getTransaction` / `getParsedTransaction` per user-submitted signature to verify.
 * - **Do** prefer `getNestingReadConnection()` (see `lib/solana/nesting/client.ts`) for read-only tx/account fetches
 *   when `SOLANA_RPC_READ_URL` is set, to leave primary RPC for sends and archival if needed.
 * - **Future:** program log subscription or webhook indexer — not implemented here; still avoid continuous polling.
 */

/** Max rows processed in one admin reconcile call (one RPC per row with a signature). */
export const NESTING_RECONCILE_MAX_BATCH = 25

/** Base58 transaction signature min/max rough bounds (ed25519 sig in tx id). */
export const NESTING_SIGNATURE_MIN_LEN = 80
export const NESTING_SIGNATURE_MAX_LEN = 100
