/**
 * Snapshot-first OWL reads for Council flows: reuse `owl_wallet_owl_snapshots` within TTL
 * so votes and eligibility rarely hit RPC (Helius credits). Uses {@link resolveServerSolanaReadRpcUrl}
 * when a refresh is needed — set `SOLANA_RPC_READ_URL` for read-heavy routing away from billed primaries.
 */

import { MIN_OWL_TO_CREATE_PROPOSAL } from '@/lib/council/owl-proposal-rules'
import { measureOwlBalanceRaw } from '@/lib/council/owl-balance-measure'
import { getOwlWalletSnapshot, upsertOwlWalletSnapshot } from '@/lib/db/owl-wallet-snapshots'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'

/** Reuse snapshot if newer than this (aligned with eligibility UI + cron refresh). */
export const OWL_PROPOSAL_SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function minRawFromDecimals(decimals: number): bigint {
  const factor = BigInt(10) ** BigInt(decimals)
  return BigInt(MIN_OWL_TO_CREATE_PROPOSAL) * factor
}

export type OwlBalanceCreditAwareResult =
  | {
      ok: true
      totalRaw: bigint
      decimals: number
      source: 'snapshot' | 'rpc'
      checkedAt: string
    }
  | {
      ok: false
      code: 'owl_disabled' | 'invalid_wallet' | 'rpc_error'
      message: string
    }

/**
 * Returns cached snapshot balance when fresh; otherwise one RPC read + upsert for later reuse.
 */
export async function getOwlRawBalanceCreditAware(
  walletAddress: string
): Promise<OwlBalanceCreditAwareResult> {
  const w = walletAddress.trim()
  if (!w) {
    return { ok: false, code: 'invalid_wallet', message: 'Wallet address required.' }
  }

  if (!isOwlEnabled()) {
    return {
      ok: false,
      code: 'owl_disabled',
      message:
        'OWL token is not configured (NEXT_PUBLIC_OWL_MINT_ADDRESS).',
    }
  }

  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) {
    return { ok: false, code: 'owl_disabled', message: 'OWL mint address missing.' }
  }

  const existing = await getOwlWalletSnapshot(w)
  const now = Date.now()

  if (existing?.checked_at && existing.balance_raw != null && existing.balance_raw !== '') {
    const checkedMs = new Date(existing.checked_at).getTime()
    if (Number.isFinite(checkedMs) && now - checkedMs < OWL_PROPOSAL_SNAPSHOT_TTL_MS) {
      let totalRaw: bigint
      try {
        totalRaw = BigInt(String(existing.balance_raw).trim())
      } catch {
        totalRaw = 0n
      }
      return {
        ok: true,
        totalRaw,
        decimals: owl.decimals,
        source: 'snapshot',
        checkedAt: existing.checked_at,
      }
    }
  }

  const measured = await measureOwlBalanceRaw(w)
  if (!measured.ok) {
    return measured
  }

  const minRaw = minRawFromDecimals(measured.decimals)
  const meetsMinProposal = measured.totalRaw >= minRaw

  await upsertOwlWalletSnapshot({
    walletAddress: w,
    balanceRaw: measured.totalRaw,
    meetsMinProposal,
  })

  const checkedAt = new Date().toISOString()

  return {
    ok: true,
    totalRaw: measured.totalRaw,
    decimals: measured.decimals,
    source: 'rpc',
    checkedAt,
  }
}
