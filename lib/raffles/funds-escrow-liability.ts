/**
 * Pure funds-escrow liability math — outstanding amounts the shared wallet must still hold.
 * Coverage evaluation mirrors Gen Owl rev-share: refuse outflows when under-covered so early
 * claimers cannot strand later hosts / refunds.
 */

export type FundsEscrowCurrencyBucket = {
  sol: number
  usdc: number
  owl: number
  bamboo: number
  goats: number
}

export type FundsEscrowLiabilityBuckets = {
  /** Unclaimed creator_payout + platform_fee on successful_pending_claims escrow raffles. */
  unclaimedRaffleSettlements: FundsEscrowCurrencyBucket
  /** Confirmed unrefunded ticket gross on failed/cancelled escrow raffles. */
  refundableTicketEntries: FundsEscrowCurrencyBucket
  /** Buyout deposits still held (active / accepted unpaid / expired-superseded unreimbursed). */
  openBuyoutDeposits: FundsEscrowCurrencyBucket
  /** Auction creator_payout + platform_fee pending claim. */
  unclaimedAuctionSettlements: FundsEscrowCurrencyBucket
  /** Auction bids still held in escrow (active or outbid without refund). */
  openAuctionBids: FundsEscrowCurrencyBucket
  /** Prefunded crypto milestones not yet claimed or returned. */
  milestoneCryptoHeld: FundsEscrowCurrencyBucket
}

export type FundsEscrowLiabilitySnapshot = {
  buckets: FundsEscrowLiabilityBuckets
  /** Sum of all buckets — what the live funds-escrow wallet should hold. */
  required: FundsEscrowCurrencyBucket
  counts: {
    unclaimedRaffleSettlements: number
    refundableTicketEntries: number
    openBuyoutDeposits: number
    unclaimedAuctionSettlements: number
    openAuctionBids: number
    milestoneCryptoHeld: number
  }
}

export type FundsEscrowPoolBalances = {
  configured: boolean
  address: string | null
  sol: number | null
  usdc: number | null
  owl: number | null
  bamboo: number | null
  goats: number | null
}

export type FundsEscrowCoverage = {
  covered: boolean
  shortfall: FundsEscrowCurrencyBucket
  /** Human-readable shortfall summary when not covered; null when covered. */
  error: string | null
}

export function emptyFundsEscrowCurrencyBucket(): FundsEscrowCurrencyBucket {
  return { sol: 0, usdc: 0, owl: 0, bamboo: 0, goats: 0 }
}

function timestampSet(value: string | null | undefined): boolean {
  return Boolean(String(value ?? '').trim())
}

/**
 * Remaining creator + platform fee still owed from funds escrow for one settled raffle.
 * `successful_pending_claims` often persists after the creator claims proceeds (NFT/winner claims still open).
 */
export function unsettledRaffleSettlementLiability(row: {
  creator_payout_amount?: number | string | null
  platform_fee_amount?: number | string | null
  creator_claimed_at?: string | null
  platform_fee_settled_at?: string | null
}): { creator: number; platformFee: number; total: number } {
  const creatorClaimed = timestampSet(row.creator_claimed_at)
  const creator = creatorClaimed ? 0 : Number(row.creator_payout_amount) || 0
  // claim-proceeds pays creator + platform fee in one tx; platform-finance treats creator_claimed_at as fee collected.
  const platformFee =
    timestampSet(row.platform_fee_settled_at) || creatorClaimed
      ? 0
      : Number(row.platform_fee_amount) || 0
  return { creator, platformFee, total: creator + platformFee }
}

/** Same partial settlement rules for auction proceeds in funds escrow. */
export function unsettledAuctionSettlementLiability(row: {
  creator_payout_amount?: number | string | null
  platform_fee_amount?: number | string | null
  creator_claimed_at?: string | null
  platform_fee_settled_at?: string | null
}): { creator: number; platformFee: number; total: number } {
  return unsettledRaffleSettlementLiability(row)
}

/** Buyout bid deposit still held in a payout/refund wallet (not yet paid out or refunded). */
export function buyoutOfferDepositStillHeld(params: {
  status: string | null | undefined
  payout_tx_signature?: string | null
}): boolean {
  const status = String(params.status || '')
  const payoutDone = Boolean(String(params.payout_tx_signature ?? '').trim())
  return (
    status === 'active' ||
    (status === 'accepted' && !payoutDone) ||
    status === 'expired' ||
    status === 'superseded'
  )
}

/** Prefunded crypto milestone still binding funds-escrow balance. */
export function milestoneCryptoBindsFundsEscrow(params: {
  status: string | null | undefined
  prize_type: string | null | undefined
}): boolean {
  if (String(params.prize_type || '') !== 'crypto') return false
  const status = String(params.status || '')
  return status !== 'claimed' && status !== 'returned' && status !== 'void'
}

export function addToFundsEscrowBucket(
  bucket: FundsEscrowCurrencyBucket,
  currency: string | null | undefined,
  amount: number
): void {
  if (!Number.isFinite(amount) || amount <= 0) return
  const c = (currency || 'SOL').toUpperCase()
  if (c === 'USDC') bucket.usdc += amount
  else if (c === 'OWL') bucket.owl += amount
  else if (c === 'BAMBOO') bucket.bamboo += amount
  else if (c === 'GOATS') bucket.goats += amount
  else if (c === 'SOL') bucket.sol += amount
}

function sumBuckets(buckets: FundsEscrowLiabilityBuckets): FundsEscrowCurrencyBucket {
  const required = emptyFundsEscrowCurrencyBucket()
  for (const b of Object.values(buckets)) {
    required.sol += b.sol
    required.usdc += b.usdc
    required.owl += b.owl
    required.bamboo += b.bamboo
    required.goats += b.goats
  }
  return required
}

export function computeFundsEscrowLiabilitySnapshot(params: {
  unclaimedRaffleSettlements: FundsEscrowCurrencyBucket
  refundableTicketEntries: FundsEscrowCurrencyBucket
  openBuyoutDeposits: FundsEscrowCurrencyBucket
  unclaimedAuctionSettlements: FundsEscrowCurrencyBucket
  openAuctionBids: FundsEscrowCurrencyBucket
  milestoneCryptoHeld: FundsEscrowCurrencyBucket
  counts: FundsEscrowLiabilitySnapshot['counts']
}): FundsEscrowLiabilitySnapshot {
  const buckets: FundsEscrowLiabilityBuckets = {
    unclaimedRaffleSettlements: { ...params.unclaimedRaffleSettlements },
    refundableTicketEntries: { ...params.refundableTicketEntries },
    openBuyoutDeposits: { ...params.openBuyoutDeposits },
    unclaimedAuctionSettlements: { ...params.unclaimedAuctionSettlements },
    openAuctionBids: { ...params.openAuctionBids },
    milestoneCryptoHeld: { ...params.milestoneCryptoHeld },
  }
  return {
    buckets,
    required: sumBuckets(buckets),
    counts: { ...params.counts },
  }
}

function heldOrZero(n: number | null | undefined): number {
  return n != null && Number.isFinite(n) ? Math.max(0, n) : 0
}

/** Largest SOL liability bucket — helps ops/support see refunds vs host settlements. */
export function describeDominantFundsEscrowSolBucket(
  buckets: FundsEscrowLiabilityBuckets
): string | null {
  const ranked: Array<{ label: string; sol: number }> = [
    { label: 'unclaimed host settlements', sol: buckets.unclaimedRaffleSettlements.sol },
    {
      label: 'ticket refunds on failed/cancelled raffles',
      sol: buckets.refundableTicketEntries.sol,
    },
    { label: 'open buyout deposits', sol: buckets.openBuyoutDeposits.sol },
    { label: 'unclaimed auction settlements', sol: buckets.unclaimedAuctionSettlements.sol },
    { label: 'open auction bids', sol: buckets.openAuctionBids.sol },
    { label: 'milestone crypto held', sol: buckets.milestoneCryptoHeld.sol },
  ]
    .filter((b) => Number.isFinite(b.sol) && b.sol > 1e-12)
    .sort((a, b) => b.sol - a.sol)
  if (ranked.length === 0) return null
  const top = ranked[0]
  return `Largest SOL bucket: ${top.label} (~${top.sol.toFixed(5)} SOL)`
}

export function evaluateFundsEscrowCoverage(params: {
  hold: FundsEscrowPoolBalances
  required: FundsEscrowCurrencyBucket
  /** Extra SOL reserved for network fees across pending outflows. */
  feeReserveSol?: number
  /** Optional — when set, shortfall error names the dominant SOL bucket. */
  buckets?: FundsEscrowLiabilityBuckets
}): FundsEscrowCoverage {
  const feeReserve = Math.max(0, Number(params.feeReserveSol) || 0)
  const requiredSol = params.required.sol + feeReserve
  const shortfall = emptyFundsEscrowCurrencyBucket()

  const holdSol = heldOrZero(params.hold.sol)
  const holdUsdc = heldOrZero(params.hold.usdc)
  const holdOwl = heldOrZero(params.hold.owl)
  const holdBamboo = heldOrZero(params.hold.bamboo)
  const holdGoats = heldOrZero(params.hold.goats)

  if (holdSol + 1e-12 < requiredSol) shortfall.sol = requiredSol - holdSol
  if (holdUsdc + 1e-12 < params.required.usdc) shortfall.usdc = params.required.usdc - holdUsdc
  if (holdOwl + 1e-12 < params.required.owl) shortfall.owl = params.required.owl - holdOwl
  if (holdBamboo + 1e-12 < params.required.bamboo) {
    shortfall.bamboo = params.required.bamboo - holdBamboo
  }
  if (holdGoats + 1e-12 < params.required.goats) shortfall.goats = params.required.goats - holdGoats

  const covered =
    shortfall.sol <= 0 &&
    shortfall.usdc <= 0 &&
    shortfall.owl <= 0 &&
    shortfall.bamboo <= 0 &&
    shortfall.goats <= 0

  if (covered) {
    return { covered: true, shortfall, error: null }
  }

  const parts: string[] = []
  if (shortfall.sol > 0) {
    parts.push(
      `SOL short ~${shortfall.sol.toFixed(5)} (needs ~${requiredSol.toFixed(5)}, holds ${holdSol.toFixed(5)})`
    )
  }
  if (shortfall.usdc > 0) {
    parts.push(
      `USDC short ~${shortfall.usdc.toFixed(2)} (needs ~${params.required.usdc.toFixed(2)}, holds ${holdUsdc.toFixed(2)})`
    )
  }
  if (shortfall.owl > 0) {
    parts.push(
      `OWL short ~${shortfall.owl.toFixed(2)} (needs ~${params.required.owl.toFixed(2)}, holds ${holdOwl.toFixed(2)})`
    )
  }
  if (shortfall.bamboo > 0) {
    parts.push(
      `BAMBOO short ~${shortfall.bamboo.toFixed(2)} (needs ~${params.required.bamboo.toFixed(2)}, holds ${holdBamboo.toFixed(2)})`
    )
  }
  if (shortfall.goats > 0) {
    parts.push(
      `GOATS short ~${shortfall.goats.toFixed(2)} (needs ~${params.required.goats.toFixed(2)}, holds ${holdGoats.toFixed(2)})`
    )
  }

  const dominant =
    shortfall.sol > 0 && params.buckets
      ? describeDominantFundsEscrowSolBucket(params.buckets)
      : null

  return {
    covered: false,
    shortfall,
    error:
      `Funds escrow cannot cover outstanding liability: ${parts.join('; ')}` +
      (dominant ? `. ${dominant}` : '') +
      `. Please contact support to top up the escrow, then try again.`,
  }
}
