/**
 * Provably-auditable raffle draw types.
 * v1 = off-chain seeded RNG + on-chain memo reveal (FFF-shaped).
 * Later algos (commit–reveal, VRF) plug in via {@link DrawAlgoId} without changing verify UX.
 */

export const DRAW_ALGO_V1 = 'owltopia-draw-v1' as const

/** Future: 'owltopia-draw-v2-commit-reveal' | 'owltopia-draw-v3-vrf' */
export type DrawAlgoId = typeof DRAW_ALGO_V1 | string

export type DrawEntryLike = {
  id: string
  wallet_address: string
  ticket_quantity: number
  status: string
  verified_at?: string | null
  created_at?: string | null
  refunded_at?: string | null
}

/** One wallet’s contiguous ticket range on the canonical ledger (inclusive start, exclusive end). */
export type DrawLedgerRange = {
  wallet: string
  tickets: number
  startIndex: number
  endIndex: number
}

export type DrawLedger = {
  ranges: DrawLedgerRange[]
  /** Total confirmed ticket weight (soldCount). */
  soldCount: number
  /** SHA-256 hex of canonical ledger lines (wallet:tickets per line, sorted). */
  ledgerHash: string
}

export type DrawResult = {
  algo: typeof DRAW_ALGO_V1
  drawSeed: string
  soldCount: number
  winnerIndex: number
  winnerWallet: string
  ledgerHash: string
  ranges: DrawLedgerRange[]
}

export type DrawRevealMemoParts = {
  algo: string
  raffleId: string
  drawSeed: string
  soldCount: number
  winnerIndex: number
  ledgerHash: string
}

export type VerifyDrawInput = {
  algo: string
  drawSeed: string
  soldCount: number
  winnerIndex: number
  winnerWallet: string
  ledgerHash: string
  /** Optional; included in returned memo string for display. */
  raffleId?: string
  /** Confirmed entries used to rebuild the ledger (same filter as draw time). */
  entries: DrawEntryLike[]
}

export type VerifyDrawResult =
  | {
      ok: true
      recomputedWinnerIndex: number
      recomputedWinnerWallet: string
      recomputedLedgerHash: string
      memo: string
    }
  | {
      ok: false
      error: string
      recomputedWinnerIndex?: number
      recomputedWinnerWallet?: string
      recomputedLedgerHash?: string
    }
