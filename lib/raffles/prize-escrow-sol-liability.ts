/**
 * Pure prize-escrow SOL liability math.
 *
 * SOL crypto prizes are deposited into the shared prize-escrow wallet (same wallet that
 * pays NFT ATA rent / transfer fees). Without tracking outstanding SOL prizes, those ops
 * (and historically VRF fee fallback) can drain native SOL below what winners are owed.
 */

export type PrizeEscrowSolLiabilityBuckets = {
  /** Verified SOL raffle prizes not yet claimed or returned. */
  unclaimedRaffleSolPrizes: number
  /** Verified SOL auction prizes not yet claimed or returned to creator. */
  unclaimedAuctionSolPrizes: number
}

export type PrizeEscrowSolLiabilitySnapshot = {
  buckets: PrizeEscrowSolLiabilityBuckets
  /** Total SOL (human units) the escrow must still be able to pay. */
  requiredSol: number
  counts: {
    unclaimedRaffleSolPrizes: number
    unclaimedAuctionSolPrizes: number
  }
}

export type PrizeEscrowSolPoolBalances = {
  configured: boolean
  address: string | null
  /** Native lamports as SOL. */
  nativeSol: number | null
  /** Escrow wSOL ATA balance as SOL (segregated prize principal). */
  wsolSol: number | null
}

export type PrizeEscrowSolCoverage = {
  covered: boolean
  shortfallSol: number
  /** Human-readable shortfall when not covered; null when covered. */
  error: string | null
}

export function emptyPrizeEscrowSolBuckets(): PrizeEscrowSolLiabilityBuckets {
  return { unclaimedRaffleSolPrizes: 0, unclaimedAuctionSolPrizes: 0 }
}

function timestampSet(value: string | null | undefined): boolean {
  return Boolean(String(value ?? '').trim())
}

/** Raffle row still binds prize-escrow SOL until paid to winner or returned to creator. */
export function raffleSolPrizeBindsEscrow(row: {
  prize_type?: string | null
  prize_currency?: string | null
  prize_deposited_at?: string | null
  prize_returned_at?: string | null
  nft_transfer_transaction?: string | null
}): boolean {
  if (String(row.prize_type || '').toLowerCase() !== 'crypto') return false
  if (String(row.prize_currency || '').trim().toUpperCase() !== 'SOL') return false
  if (!timestampSet(row.prize_deposited_at)) return false
  if (timestampSet(row.prize_returned_at)) return false
  if (timestampSet(row.nft_transfer_transaction)) return false
  return true
}

/** Auction row still binds prize-escrow SOL until claimed (winner or creator return). */
export function auctionSolPrizeBindsEscrow(row: {
  prize_type?: string | null
  prize_deposited_at?: string | null
  prize_claimed_at?: string | null
}): boolean {
  if (String(row.prize_type || '').toLowerCase() !== 'sol') return false
  if (!timestampSet(row.prize_deposited_at)) return false
  if (timestampSet(row.prize_claimed_at)) return false
  return true
}

export function computePrizeEscrowSolLiabilitySnapshot(params: {
  unclaimedRaffleSolPrizes: number
  unclaimedAuctionSolPrizes: number
  raffleCount: number
  auctionCount: number
}): PrizeEscrowSolLiabilitySnapshot {
  const buckets: PrizeEscrowSolLiabilityBuckets = {
    unclaimedRaffleSolPrizes: Math.max(0, params.unclaimedRaffleSolPrizes),
    unclaimedAuctionSolPrizes: Math.max(0, params.unclaimedAuctionSolPrizes),
  }
  return {
    buckets,
    requiredSol: buckets.unclaimedRaffleSolPrizes + buckets.unclaimedAuctionSolPrizes,
    counts: {
      unclaimedRaffleSolPrizes: params.raffleCount,
      unclaimedAuctionSolPrizes: params.auctionCount,
    },
  }
}

/**
 * Coverage: native SOL + wSOL must cover outstanding SOL prizes plus a small fee reserve
 * (so one SystemProgram.transfer can still land).
 */
export function evaluatePrizeEscrowSolCoverage(params: {
  nativeSol: number | null | undefined
  wsolSol: number | null | undefined
  requiredSol: number
  feeReserveSol?: number
}): PrizeEscrowSolCoverage {
  const feeReserve = params.feeReserveSol ?? 0.00001
  if (params.nativeSol == null && params.wsolSol == null) {
    return { covered: true, shortfallSol: 0, error: null }
  }
  const hold =
    Math.max(0, params.nativeSol ?? 0) + Math.max(0, params.wsolSol ?? 0)
  const need = Math.max(0, params.requiredSol) + feeReserve
  const shortfallSol = Math.max(0, need - hold)
  if (shortfallSol <= 1e-12) {
    return { covered: true, shortfallSol: 0, error: null }
  }
  return {
    covered: false,
    shortfallSol,
    error:
      `Prize escrow SOL shortfall: need ~${need.toFixed(4)} SOL ` +
      `(outstanding prizes ~${params.requiredSol.toFixed(4)} + fee reserve) ` +
      `but hold only ~${hold.toFixed(4)} SOL (native ~${(params.nativeSol ?? 0).toFixed(4)}, ` +
      `wSOL ~${(params.wsolSol ?? 0).toFixed(4)}). Top up the prize escrow wallet, then retry.`,
  }
}

/**
 * After spending `spendSol` from native balance, would outstanding SOL prizes still be covered?
 * Used to refuse NFT ATA rent / fee spends that would strand SOL prize winners.
 */
export function evaluatePrizeEscrowSolCoverageAfterNativeSpend(params: {
  nativeSol: number | null | undefined
  wsolSol: number | null | undefined
  requiredSol: number
  spendSol: number
  feeReserveSol?: number
}): PrizeEscrowSolCoverage {
  const nativeAfter = Math.max(0, (params.nativeSol ?? 0) - Math.max(0, params.spendSol))
  return evaluatePrizeEscrowSolCoverage({
    nativeSol: params.nativeSol == null && params.wsolSol == null ? null : nativeAfter,
    wsolSol: params.wsolSol,
    requiredSol: params.requiredSol,
    feeReserveSol: params.feeReserveSol,
  })
}
