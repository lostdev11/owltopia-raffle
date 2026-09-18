/**
 * Load funds-escrow outstanding liability from DB and compare to on-chain balances.
 * Used to refuse claim/refund/buyout outflows when the shared wallet is under-covered.
 */
import { PublicKey } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSolanaReadConnection } from '@/lib/solana/connection'
import { getTokenInfo } from '@/lib/tokens'
import { getFundsEscrowPublicKey } from '@/lib/raffles/funds-escrow'
import {
  addToFundsEscrowBucket,
  buyoutOfferDepositStillHeld,
  computeFundsEscrowLiabilitySnapshot,
  emptyFundsEscrowCurrencyBucket,
  evaluateFundsEscrowCoverage,
  milestoneCryptoBindsFundsEscrow,
  unsettledAuctionSettlementLiability,
  unsettledRaffleSettlementLiability,
  type FundsEscrowCoverage,
  type FundsEscrowLiabilitySnapshot,
  type FundsEscrowPoolBalances,
} from '@/lib/raffles/funds-escrow-liability'
import { filterBuyoutOffersInFundsEscrow } from '@/lib/raffles/funds-escrow-buyout-liability'

const TOKEN_PROGRAM_IDS = [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID] as const

/** ~15k lamports × expected concurrent SOL outflows — keep modest. */
const FEE_RESERVE_SOL = 0.002

export type FundsEscrowLiabilityWithCoverage = {
  liability: FundsEscrowLiabilitySnapshot
  coverage: FundsEscrowCoverage
  pool: FundsEscrowPoolBalances
  feeReserveSol: number
}

async function readTokenBalance(
  owner: PublicKey,
  currency: 'USDC' | 'OWL' | 'BAMBOO' | 'GOATS'
): Promise<number | null> {
  const info = getTokenInfo(currency)
  if (!info.mintAddress) return null
  const mint = new PublicKey(info.mintAddress)
  const connection = getSolanaReadConnection()
  for (const programId of TOKEN_PROGRAM_IDS) {
    try {
      const ata = await getAssociatedTokenAddress(
        mint,
        owner,
        false,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      const acct = await getAccount(connection, ata, 'confirmed', programId)
      return Number(acct.amount) / Math.pow(10, info.decimals)
    } catch {
      // try next program
    }
  }
  return 0
}

export async function getFundsEscrowPoolBalances(): Promise<FundsEscrowPoolBalances> {
  const address = getFundsEscrowPublicKey()
  if (!address) {
    return {
      configured: false,
      address: null,
      sol: null,
      usdc: null,
      owl: null,
      bamboo: null,
      goats: null,
    }
  }
  try {
    const owner = new PublicKey(address)
    const connection = getSolanaReadConnection()
    const [solLamports, usdc, owl, bamboo, goats] = await Promise.all([
      connection.getBalance(owner, 'confirmed'),
      readTokenBalance(owner, 'USDC'),
      readTokenBalance(owner, 'OWL'),
      readTokenBalance(owner, 'BAMBOO'),
      readTokenBalance(owner, 'GOATS'),
    ])
    return {
      configured: true,
      address,
      sol: solLamports / 1_000_000_000,
      usdc,
      owl,
      bamboo,
      goats,
    }
  } catch (e) {
    console.warn(
      '[funds-escrow-liability] failed to read on-chain balances:',
      e instanceof Error ? e.message : e
    )
    return {
      configured: true,
      address,
      sol: null,
      usdc: null,
      owl: null,
      bamboo: null,
      goats: null,
    }
  }
}

export async function loadFundsEscrowLiabilitySnapshot(): Promise<FundsEscrowLiabilitySnapshot> {
  const db = getSupabaseAdmin()

  const unclaimedRaffleSettlements = emptyFundsEscrowCurrencyBucket()
  const refundableTicketEntries = emptyFundsEscrowCurrencyBucket()
  const openBuyoutDeposits = emptyFundsEscrowCurrencyBucket()
  const unclaimedAuctionSettlements = emptyFundsEscrowCurrencyBucket()
  const openAuctionBids = emptyFundsEscrowCurrencyBucket()
  const milestoneCryptoHeld = emptyFundsEscrowCurrencyBucket()
  const counts = {
    unclaimedRaffleSettlements: 0,
    refundableTicketEntries: 0,
    openBuyoutDeposits: 0,
    unclaimedAuctionSettlements: 0,
    openAuctionBids: 0,
    milestoneCryptoHeld: 0,
  }

  const [rafflesRes, auctionsRes, buyoutsRes, auctionBidsRes, milestonesRes, escrowRafflesRes] =
    await Promise.all([
    db
      .from('raffles')
      .select(
        'id, currency, creator_payout_amount, platform_fee_amount, status, creator_claimed_at, platform_fee_settled_at, ticket_payments_to_funds_escrow, settled_at'
      )
      .eq('ticket_payments_to_funds_escrow', true)
      .eq('status', 'successful_pending_claims')
      .not('settled_at', 'is', null)
      .limit(10000),
    db
      .from('nft_auctions')
      .select(
        'id, bid_currency, creator_payout_amount, platform_fee_amount, status, creator_claimed_at'
      )
      .eq('status', 'successful_pending_claims')
      .limit(5000),
    db
      .from('raffle_buyout_offers')
      .select(
        'amount, currency, status, deposit_tx_signature, payout_tx_signature, refunded_at, raffle_id, bidder_wallet'
      )
      .not('deposit_tx_signature', 'is', null)
      .is('refunded_at', null)
      .limit(20000),
    db
      .from('nft_auction_bids')
      .select('amount, currency, status, refunded_at, deposit_tx_signature')
      .not('deposit_tx_signature', 'is', null)
      .is('refunded_at', null)
      // Exclude `won` — that deposit is already counted in unclaimed auction settlements.
      .in('status', ['active', 'outbid'])
      .limit(20000),
    db
      .from('raffle_milestones')
      .select('prize_amount, prize_currency, prize_type, deposit_verified_at, claimed_at, returned_at, status')
      .eq('prize_type', 'crypto')
      .not('deposit_verified_at', 'is', null)
      .is('claimed_at', null)
      .is('returned_at', null)
      .limit(20000),
    db.from('raffles').select('id').eq('ticket_payments_to_funds_escrow', true).limit(10000),
  ])

  const escrowRaffleIds = new Set(
    (escrowRafflesRes.data ?? []).map((r) => String(r.id)).filter(Boolean)
  )

  for (const row of rafflesRes.data ?? []) {
    const { total } = unsettledRaffleSettlementLiability(row)
    if (total <= 0) continue
    const currency = String(row.currency || 'SOL')
    addToFundsEscrowBucket(unclaimedRaffleSettlements, currency, total)
    counts.unclaimedRaffleSettlements += 1
  }

  for (const row of auctionsRes.data ?? []) {
    const { total } = unsettledAuctionSettlementLiability(row)
    if (total <= 0) continue
    const currency = String(row.bid_currency || 'SOL')
    addToFundsEscrowBucket(unclaimedAuctionSettlements, currency, total)
    counts.unclaimedAuctionSettlements += 1
  }

  const buyoutHeld = (buyoutsRes.data ?? []).filter(
    (row) =>
      escrowRaffleIds.has(String(row.raffle_id)) &&
      buyoutOfferDepositStillHeld({
        status: row.status,
        payout_tx_signature: row.payout_tx_signature,
      })
  )
  const buyoutsInFundsEscrow = await filterBuyoutOffersInFundsEscrow(buyoutHeld)
  for (const row of buyoutsInFundsEscrow) {
    addToFundsEscrowBucket(openBuyoutDeposits, String(row.currency || 'SOL'), Number(row.amount) || 0)
    counts.openBuyoutDeposits += 1
  }

  for (const row of auctionBidsRes.data ?? []) {
    addToFundsEscrowBucket(openAuctionBids, String(row.currency || 'SOL'), Number(row.amount) || 0)
    counts.openAuctionBids += 1
  }

  for (const row of milestonesRes.data ?? []) {
    if (
      !milestoneCryptoBindsFundsEscrow({
        status: row.status,
        prize_type: row.prize_type,
      })
    ) {
      continue
    }
    addToFundsEscrowBucket(
      milestoneCryptoHeld,
      String(row.prize_currency || 'SOL'),
      Number(row.prize_amount) || 0
    )
    counts.milestoneCryptoHeld += 1
  }

  // Refundable tickets: join via raffle status (failed/cancelled + escrow).
  const refundRafflesRes = await db
    .from('raffles')
    .select('id')
    .eq('ticket_payments_to_funds_escrow', true)
    .in('status', ['failed_refund_available', 'cancelled'])
    .limit(10000)

  const refundRaffleIds = (refundRafflesRes.data ?? []).map((r) => String(r.id)).filter(Boolean)
  const chunkSize = 200
  for (let i = 0; i < refundRaffleIds.length; i += chunkSize) {
    const chunk = refundRaffleIds.slice(i, i + chunkSize)
    const { data: entries } = await db
      .from('entries')
      .select('amount_paid, currency, referral_complimentary, status, refunded_at')
      .in('raffle_id', chunk)
      .eq('status', 'confirmed')
      .is('refunded_at', null)
      .limit(50000)
    for (const e of entries ?? []) {
      if (e.referral_complimentary === true) continue
      const amount = Number(e.amount_paid) || 0
      if (amount <= 0) continue
      addToFundsEscrowBucket(refundableTicketEntries, String(e.currency || 'SOL'), amount)
      counts.refundableTicketEntries += 1
    }
  }

  return computeFundsEscrowLiabilitySnapshot({
    unclaimedRaffleSettlements,
    refundableTicketEntries,
    openBuyoutDeposits,
    unclaimedAuctionSettlements,
    openAuctionBids,
    milestoneCryptoHeld,
    counts,
  })
}

export async function loadFundsEscrowLiabilityWithCoverage(): Promise<FundsEscrowLiabilityWithCoverage> {
  const [liability, pool] = await Promise.all([
    loadFundsEscrowLiabilitySnapshot(),
    getFundsEscrowPoolBalances(),
  ])
  const coverage = evaluateFundsEscrowCoverage({
    hold: pool,
    required: liability.required,
    feeReserveSol: FEE_RESERVE_SOL,
    buckets: liability.buckets,
  })
  return { liability, coverage, pool, feeReserveSol: FEE_RESERVE_SOL }
}

/**
 * Refuse funds-escrow outflows when the shared wallet cannot cover outstanding liability.
 * On RPC/config failure (null balances), do not block — per-payout shortfall checks still apply.
 */
export async function assertFundsEscrowOutstandingLiabilityCovered(): Promise<
  | { ok: true; snapshot: FundsEscrowLiabilityWithCoverage }
  | { ok: false; error: string; snapshot: FundsEscrowLiabilityWithCoverage }
> {
  const snapshot = await loadFundsEscrowLiabilityWithCoverage()
  if (!snapshot.pool.configured) {
    return { ok: false, error: 'Funds escrow is not configured (FUNDS_ESCROW_SECRET_KEY).', snapshot }
  }
  // If we could not read balances, skip the global gate (do not block on RPC blips).
  if (snapshot.pool.sol == null) {
    return { ok: true, snapshot }
  }
  if (!snapshot.coverage.covered && snapshot.coverage.error) {
    return { ok: false, error: snapshot.coverage.error, snapshot }
  }
  return { ok: true, snapshot }
}

/** Draw-time best-effort log when this settlement alone already exceeds live SOL/token balance. */
export async function warnIfFundsEscrowShortForSettlement(params: {
  raffleId: string
  currency: string
  creatorPayout: number
  platformFee: number
}): Promise<void> {
  const pool = await getFundsEscrowPoolBalances()
  if (!pool.configured || pool.sol == null) return
  const needed = (Number(params.creatorPayout) || 0) + (Number(params.platformFee) || 0)
  if (needed <= 0) return
  const cur = (params.currency || 'SOL').toUpperCase()
  let hold = 0
  if (cur === 'SOL') hold = pool.sol ?? 0
  else if (cur === 'USDC') hold = pool.usdc ?? 0
  else if (cur === 'OWL') hold = pool.owl ?? 0
  else if (cur === 'BAMBOO') hold = pool.bamboo ?? 0
  else if (cur === 'GOATS') hold = pool.goats ?? 0
  if (hold + 1e-12 >= needed) return
  console.error('[funds-escrow] draw-time solvency warning', {
    raffleId: params.raffleId,
    currency: cur,
    needed,
    hold,
    escrow: pool.address,
  })
}
