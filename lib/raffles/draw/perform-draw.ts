import { buildDrawLedger, walletForTicketIndex } from '@/lib/raffles/draw/ledger'
import { encodeDrawRevealMemo } from '@/lib/raffles/draw/memo'
import { pickWinnerIndex } from '@/lib/raffles/draw/rng'
import { DRAW_ALGO_V1, type DrawResult, type VerifyDrawInput, type VerifyDrawResult } from '@/lib/raffles/draw/types'
import type { DrawEntryLike } from '@/lib/raffles/draw/types'
import { generateDrawSeed } from '@/lib/raffles/draw/rng'

/**
 * Run a v1 draw against confirmed entries. Pure — no DB / chain I/O.
 */
export function performDrawV1(entries: DrawEntryLike[], drawSeed?: string): DrawResult {
  const ledger = buildDrawLedger(entries)
  if (ledger.soldCount <= 0) {
    throw new Error('No drawable tickets')
  }
  const seed = (drawSeed?.trim() || generateDrawSeed()).trim()
  const winnerIndex = pickWinnerIndex(DRAW_ALGO_V1, seed, ledger.soldCount)
  const winnerWallet = walletForTicketIndex(ledger.ranges, winnerIndex)
  if (!winnerWallet) {
    throw new Error('winnerIndex did not map to a wallet')
  }
  return {
    algo: DRAW_ALGO_V1,
    drawSeed: seed,
    soldCount: ledger.soldCount,
    winnerIndex,
    winnerWallet,
    ledgerHash: ledger.ledgerHash,
    ranges: ledger.ranges,
  }
}

/**
 * Recompute and check stored draw fields against the entry set.
 */
export function verifyDraw(input: VerifyDrawInput): VerifyDrawResult {
  const algo = input.algo.trim() || DRAW_ALGO_V1
  if (algo !== DRAW_ALGO_V1) {
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

  let recomputedWinnerIndex: number
  try {
    recomputedWinnerIndex = pickWinnerIndex(algo, input.drawSeed.trim(), input.soldCount)
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to recompute winner index',
      recomputedLedgerHash: ledger.ledgerHash,
    }
  }

  if (recomputedWinnerIndex !== input.winnerIndex) {
    return {
      ok: false,
      error: `winnerIndex mismatch: stored ${input.winnerIndex}, recomputed ${recomputedWinnerIndex}`,
      recomputedWinnerIndex,
      recomputedLedgerHash: ledger.ledgerHash,
    }
  }

  const recomputedWinnerWallet = walletForTicketIndex(ledger.ranges, recomputedWinnerIndex)
  if (!recomputedWinnerWallet) {
    return {
      ok: false,
      error: 'Recomputed index did not map to a wallet',
      recomputedWinnerIndex,
      recomputedLedgerHash: ledger.ledgerHash,
    }
  }

  if (recomputedWinnerWallet !== input.winnerWallet.trim()) {
    return {
      ok: false,
      error: `winnerWallet mismatch: stored ${input.winnerWallet}, recomputed ${recomputedWinnerWallet}`,
      recomputedWinnerIndex,
      recomputedWinnerWallet,
      recomputedLedgerHash: ledger.ledgerHash,
    }
  }

  const memo = encodeDrawRevealMemo({
    algo,
    raffleId: (input.raffleId || 'verify').trim(),
    drawSeed: input.drawSeed.trim(),
    soldCount: input.soldCount,
    winnerIndex: input.winnerIndex,
    ledgerHash: ledger.ledgerHash,
  })

  return {
    ok: true,
    recomputedWinnerIndex,
    recomputedWinnerWallet,
    recomputedLedgerHash: ledger.ledgerHash,
    memo,
  }
}
