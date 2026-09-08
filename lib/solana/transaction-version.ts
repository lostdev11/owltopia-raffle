/**
 * Highest Solana transaction message version this app can decode via RPC.
 *
 * SIMD-0385 / larger transaction sizes introduce `v1` (up to 4096 bytes).
 * Passing `0` (or omitting the field) makes `getTransaction` / `getBlock` fail
 * with RPC -32015 once any v1 transaction appears on the cluster.
 *
 * `1` is a ceiling, not a request for v1: legacy and v0 responses are unchanged.
 * See https://solana.com/upgrades/larger-transaction-sizes
 *
 * Requires `@solana/web3.js` >= 1.99.0-beta.0 for read-only v1 decode support.
 */
export const MAX_SUPPORTED_TRANSACTION_VERSION = 1 as const

/** Default config fragment for getTransaction / getParsedTransaction. */
export const RPC_MAX_SUPPORTED_TRANSACTION_VERSION = {
  maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
} as const
