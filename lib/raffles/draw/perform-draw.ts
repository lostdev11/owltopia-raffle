import { buildDrawLedger, walletForTicketIndex } from '@/lib/raffles/draw/ledger'
import { encodeDrawRevealMemo } from '@/lib/raffles/draw/memo'
import { generateDrawSeed, hashDrawCommit, pickWinnerIndex } from '@/lib/raffles/draw/rng'
import {
  DRAW_ALGO_V1,
  DRAW_ALGO_V2_COMMIT_REVEAL,
  type DrawAlgoId,
  type DrawEntryLike,
  type DrawResult,
  type VerifyDrawInput,
  type VerifyDrawResult,
} from '@/lib/raffles/draw/types'

export type PerformDrawOptions = {
  /** Pre-committed seed (required for v2; optional for v1 — generated if omitted). */
  drawSeed?: string
  algo?: DrawAlgoId
  /** When set, must equal sha256(drawSeed). Required for v2. */
  drawCommitHash?: string | null
}

/**
 * Run a draw against confirmed entries. Pure — no DB / chain I/O.
 */
export function performDraw(entries: DrawEntryLike[], options: PerformDrawOptions = {}): DrawResult {
  const algo = (options.algo?.trim() || DRAW_ALGO_V1) as DrawAlgoId
  const ledger = buildDrawLedger(entries)
  if (ledger.soldCount <= 0) {
    throw new Error('No drawable tickets')
  }

  const seed = (options.drawSeed?.trim() || generateDrawSeed()).trim()
  if (!seed) throw new Error('drawSeed is required')

  const commitHash = options.drawCommitHash?.trim().toLowerCase() || null
  if (algo === DRAW_ALGO_V2_COMMIT_REVEAL) {
    if (!commitHash) {
      throw new Error('drawCommitHash is required for commit–reveal draws')
    }
    const recomputed = hashDrawCommit(seed)
    if (recomputed !== commitHash) {
      throw new Error('drawSeed does not match drawCommitHash')
    }
  } else if (commitHash) {
    const recomputed = hashDrawCommit(seed)
    if (recomputed !== commitHash) {
      throw new Error('drawSeed does not match drawCommitHash')
    }
  }

  const winnerIndex = pickWinnerIndex(algo, seed, ledger.soldCount)
  const winnerWallet = walletForTicketIndex(ledger.ranges, winnerIndex)
  if (!winnerWallet) {
    throw new Error('winnerIndex did not map to a wallet')
  }

  return {
    algo,
    drawSeed: seed,
    soldCount: ledger.soldCount,
    winnerIndex,
    winnerWallet,
    ledgerHash: ledger.ledgerHash,
    ranges: ledger.ranges,
    drawCommitHash: commitHash,
  }
}

/** @deprecated Prefer {@link performDraw}; kept for callers/tests. */
export function performDrawV1(entries: DrawEntryLike[], drawSeed?: string): DrawResult {
  return performDraw(entries, { algo: DRAW_ALGO_V1, drawSeed })
}

/**
 * Recompute and check stored draw fields against the entry set.
 */
export function verifyDraw(input: VerifyDrawInput): VerifyDrawResult {
  const algo = input.algo.trim() || DRAW_ALGO_V1
  if (algo !== DRAW_ALGO_V1 && algo !== DRAW_ALGO_V2_COMMIT_REVEAL) {
    return { ok: false, error: `Unsupported draw algo: ${algo}` }
  }

  const ledger = buildDrawLedger(input.entries)
  if (ledger.soldCount <= 0) {
    return { ok: false, error: 'No drawable tickets in entry set' }
  }

  if (ledger.soldCount !== input.soldCount) {
    return {
      ok: false,
      error: `soldCount mismatch: stored ${input.soldCount}, recomputed ${ledger.soldCount}`,
      recomputedLedgerHash: ledger.ledgerHash,
    }
  }

  if (ledger.ledgerHash !== input.ledgerHash.trim().toLowerCase()) {
    return {
      ok: false,
      error: 'ledgerHash mismatch — entry set or ordering differs from draw time',
      recomputedLedgerHash: ledger.ledgerHash,
    }
  }

  const seed = input.drawSeed.trim()
  let recomputedCommitHash: string | undefined
  try {
    recomputedCommitHash = hashDrawCommit(seed)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Invalid draw seed',
      recomputedLedgerHash: ledger.ledgerHash,
    }
  }

  const storedCommit = input.drawCommitHash?.trim().toLowerCase() || null
  if (algo === DRAW_ALGO_V2_COMMIT_REVEAL) {
    if (!storedCommit) {
      return {
        ok: false,
        error: 'drawCommitHash missing for commit–reveal draw',
        recomputedLedgerHash: ledger.ledgerHash,
        recomputedCommitHash,
      }
    }
    if (recomputedCommitHash !== storedCommit) {
      return {
        ok: false,
        error: 'commit hash mismatch — revealed seed does not match the pre-draw commit',
        recomputedLedgerHash: ledger.ledgerHash,
        recomputedCommitHash,
      }
    }
  } else if (storedCommit && recomputedCommitHash !== storedCommit) {
    return {
      ok: false,
      error: 'commit hash mismatch — revealed seed does not match draw_commit_hash',
      recomputedLedgerHash: ledger.ledgerHash,
      recomputedCommitHash,
    }
  }

  let recomputedWinnerIndex: number
  try {
    recomputedWinnerIndex = pickWinnerIndex(algo, seed, input.soldCount)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to recompute winner index',
      recomputedLedgerHash: ledger.ledgerHash,
      recomputedCommitHash,
    }
  }

  if (recomputedWinnerIndex !== input.winnerIndex) {
    return {
      ok: false,
      error: `winnerIndex mismatch: stored ${input.winnerIndex}, recomputed ${recomputedWinnerIndex}`,
      recomputedWinnerIndex,
      recomputedLedgerHash: ledger.ledgerHash,
      recomputedCommitHash,
    }
  }

  const recomputedWinnerWallet = walletForTicketIndex(ledger.ranges, recomputedWinnerIndex)
  if (!recomputedWinnerWallet) {
    return {
      ok: false,
      error: 'Recomputed index did not map to a wallet',
      recomputedWinnerIndex,
      recomputedLedgerHash: ledger.ledgerHash,
      recomputedCommitHash,
    }
  }

  if (recomputedWinnerWallet !== input.winnerWallet.trim()) {
    return {
      ok: false,
      error: `winnerWallet mismatch: stored ${input.winnerWallet}, recomputed ${recomputedWinnerWallet}`,
      recomputedWinnerIndex,
      recomputedWinnerWallet,
      recomputedLedgerHash: ledger.ledgerHash,
      recomputedCommitHash,
    }
  }

  const memo = encodeDrawRevealMemo({
    algo,
    raffleId: (input.raffleId || 'verify').trim(),
    drawSeed: seed,
    soldCount: input.soldCount,
    winnerIndex: input.winnerIndex,
    ledgerHash: ledger.ledgerHash,
  })

  return {
    ok: true,
    recomputedWinnerIndex,
    recomputedWinnerWallet,
    recomputedLedgerHash: ledger.ledgerHash,
    recomputedCommitHash,
    memo,
  }
}
