/**
 * Provably-auditable raffle draw types.
 * v1 = seed chosen at draw + on-chain memo reveal (FFF-shaped).
 * v2 = commit–reveal: hash(seed) published at create; seed revealed at draw.
 * v3 = Switchboard VRF output becomes the seed at draw time (same index math).
 */

export const DRAW_ALGO_V1 = 'owltopia-draw-v1' as const
export const DRAW_ALGO_V2_COMMIT_REVEAL = 'owltopia-draw-v2-commit-reveal' as const
export const DRAW_ALGO_V3_VRF = 'owltopia-draw-v3-vrf' as const

export type DrawAlgoId =
  | typeof DRAW_ALGO_V1
  | typeof DRAW_ALGO_V2_COMMIT_REVEAL
  | typeof DRAW_ALGO_V3_VRF
  | string

export type DrawVrfStatus = 'pending' | 'failed' | 'fulfilled'

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
  algo: DrawAlgoId
  drawSeed: string
  soldCount: number
  winnerIndex: number
  winnerWallet: string
  ledgerHash: string
  ranges: DrawLedgerRange[]
  /** Present when algo is commit–reveal. */
  drawCommitHash?: string | null
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
  /**
   * When set (v2), verify sha256(drawSeed) === drawCommitHash.
   * Required for owltopia-draw-v2-commit-reveal.
   */
  drawCommitHash?: string | null
  /** Confirmed entries used to rebuild the ledger (same filter as draw time). */
  entries: DrawEntryLike[]
}

export type VerifyDrawResult =
  | {
      ok: true
      recomputedWinnerIndex: number
      recomputedWinnerWallet: string
      recomputedLedgerHash: string
      recomputedCommitHash?: string
      memo: string
    }
  | {
      ok: false
      error: string
      recomputedWinnerIndex?: number
      recomputedWinnerWallet?: string
      recomputedLedgerHash?: string
      recomputedCommitHash?: string
    }
