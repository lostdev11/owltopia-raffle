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

/** Max active nests to on-chain lock-check per wallet diagnostics / support playbook (one RPC each). */
export const NESTING_DIAGNOSTIC_MAX_ACTIVE_LOCK_CHECKS = 8

/** Max wallet NFT mints to cross-check against DB open rows (one query each). */
export const NESTING_DIAGNOSTIC_MAX_WALLET_MINT_CROSS_CHECKS = 16

/** Base58 transaction signature min/max rough bounds (ed25519 sig in tx id). */
export const NESTING_SIGNATURE_MIN_LEN = 80
export const NESTING_SIGNATURE_MAX_LEN = 100
