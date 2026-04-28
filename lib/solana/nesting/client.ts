/**
 * Nesting-specific Solana RPC entry points (low-credit architecture).
 *
 * Policy (see also `lib/nesting/rpc-policy.ts` and `lib/nesting/chain-tx.ts`):
 * - **No** wallet-wide token/NFT holder scans, DAS portfolio sweeps, or per-page `getProgramAccounts` dumps.
 * - **No** client-side or server-side tight polling loops for nesting state; UI reads Supabase; chain is verified
 *   only for **explicit** user/admin actions (single `getParsedTransaction(signature)` per call today).
 * - **Prefer** `getNestingReadConnection()` for read-only verification when `SOLANA_RPC_READ_URL` is set so primary
 *   / Helius stays reserved for sends, archival `getTransaction`, or program-specific needs.
 * - **Future:** optional indexer webhooks or rare cron batches — still bounded (`NESTING_RECONCILE_MAX_BATCH`).
 */

import { getSolanaConnection, getSolanaReadConnection } from '@/lib/solana/connection'
import type { Connection } from '@solana/web3.js'

/** Sends, confirms, and other primary-RPC work for nesting once instructions exist. */
export function getNestingConnection(): Connection {
  return getSolanaConnection()
}

/**
 * Read-focused RPC for nesting verification (`getParsedTransaction`, targeted account reads).
 * When unset, falls back to the primary URL — still use **one-shot** calls only.
 */
export function getNestingReadConnection(): Connection {
  return getSolanaReadConnection()
}
