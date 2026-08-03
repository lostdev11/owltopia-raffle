/**
 * Pure helpers for VRF ledger freeze / refresh decisions.
 *
 * A failed Switchboard commit that never created an on-chain randomness account
 * must not permanently freeze an outdated ticket ledger — admins may extend the
 * raffle and more tickets can sell before the next draw attempt.
 */
import { buildDrawLedger } from '@/lib/raffles/draw/ledger'
import type { DrawEntryLike } from '@/lib/raffles/draw/types'

export type VrfLedgerSnapshot = {
  soldCount: number
  ledgerHash: string
  /** True when we replaced a prior freeze because randomness never hit chain. */
  refreshed: boolean
}

export function vrfRequestReachedChain(raffle: {
  draw_vrf_account?: string | null
  draw_vrf_request_tx?: string | null
}): boolean {
  return Boolean((raffle.draw_vrf_account ?? '').trim() || (raffle.draw_vrf_request_tx ?? '').trim())
}

/**
 * Choose the ticket ledger for a VRF attempt.
 *
 * - No prior freeze → build from current confirmed entries.
 * - Prior freeze + randomness already on-chain → keep freeze; caller must refuse if entries diverged.
 * - Prior freeze + never reached chain (or explicit refresh) → re-snapshot from current entries.
 */
export function resolveVrfDrawLedger(params: {
  raffle: {
    draw_sold_count?: number | null
    draw_ledger_hash?: string | null
    draw_vrf_account?: string | null
    draw_vrf_request_tx?: string | null
  }
  entries: DrawEntryLike[]
  /** Admin retry / new commit after a pre-chain failure. */
  allowRefreshIfNeverReachedChain?: boolean
}): VrfLedgerSnapshot | { error: string; soldCount: number; ledgerHash: string } {
  const { raffle, entries, allowRefreshIfNeverReachedChain = true } = params
  const live = buildDrawLedger(entries)
  if (live.soldCount <= 0) {
    return { error: 'No drawable tickets', soldCount: 0, ledgerHash: '' }
  }

  const frozenSold = raffle.draw_sold_count ?? null
  const frozenHash = (raffle.draw_ledger_hash ?? '').trim().toLowerCase() || null
  const hasFreeze = frozenSold != null && Boolean(frozenHash)
  const reachedChain = vrfRequestReachedChain(raffle)

  if (!hasFreeze) {
    return { soldCount: live.soldCount, ledgerHash: live.ledgerHash, refreshed: false }
  }

  if (!reachedChain && allowRefreshIfNeverReachedChain) {
    const changed = live.ledgerHash !== frozenHash || live.soldCount !== frozenSold
    return {
      soldCount: live.soldCount,
      ledgerHash: live.ledgerHash,
      refreshed: changed,
    }
  }

  if (live.ledgerHash !== frozenHash || live.soldCount !== frozenSold) {
    return {
      error:
        'Frozen draw ledger no longer matches confirmed entries — refusing VRF (ticket set changed).',
      soldCount: frozenSold!,
      ledgerHash: frozenHash!,
    }
  }

  return { soldCount: frozenSold!, ledgerHash: frozenHash!, refreshed: false }
}
