/**
 * Load prize-escrow outstanding SOL prize liability from DB and compare to on-chain balances.
 * Refuse NFT / fee outflows that would leave SOL prize winners under-covered.
 */
import { PublicKey } from '@solana/web3.js'
import {
  getAssociatedTokenAddress,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { getSolanaReadConnection } from '@/lib/solana/connection'
import { getPrizeEscrowPublicKey } from '@/lib/raffles/prize-escrow'
import { WSOL_MINT_MAINNET } from '@/lib/partner-prize-tokens'
import {
  auctionSolPrizeBindsEscrow,
  computePrizeEscrowSolLiabilitySnapshot,
  evaluatePrizeEscrowSolCoverage,
  evaluatePrizeEscrowSolCoverageAfterNativeSpend,
  raffleSolPrizeBindsEscrow,
  type PrizeEscrowSolCoverage,
  type PrizeEscrowSolLiabilitySnapshot,
  type PrizeEscrowSolPoolBalances,
} from '@/lib/raffles/prize-escrow-sol-liability'

/** Keep enough native SOL for one prize transfer after covering outstanding prizes. */
const FEE_RESERVE_SOL = 0.00001

/**
 * Typical Token account rent-exempt minimum + small fee buffer.
 * Used when estimating NFT/fungible ATA creation spend from prize escrow.
 */
export const PRIZE_ESCROW_ATA_RENT_SOL = 0.00204

export type PrizeEscrowSolLiabilityWithCoverage = {
  liability: PrizeEscrowSolLiabilitySnapshot
  coverage: PrizeEscrowSolCoverage
  pool: PrizeEscrowSolPoolBalances
  feeReserveSol: number
}

export async function getPrizeEscrowSolPoolBalances(): Promise<PrizeEscrowSolPoolBalances> {
  const address = getPrizeEscrowPublicKey()
  if (!address) {
    return { configured: false, address: null, nativeSol: null, wsolSol: null }
  }
  const connection = getSolanaReadConnection()
  const owner = new PublicKey(address)
  let nativeSol: number | null = null
  let wsolSol: number | null = null
  try {
    const lamports = await connection.getBalance(owner, 'confirmed')
    nativeSol = lamports / 1e9
  } catch (e) {
    console.warn(
      '[prize-escrow-sol-liability] failed to read native balance:',
      e instanceof Error ? e.message : e
    )
  }
  try {
    const mint = new PublicKey(WSOL_MINT_MAINNET)
    const ata = await getAssociatedTokenAddress(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    const acct = await getAccount(connection, ata, 'confirmed', TOKEN_PROGRAM_ID)
    wsolSol = Number(acct.amount) / 1e9
  } catch {
    // No wSOL ATA yet — treat as 0 when we could read native; leave null only if RPC is broken.
    if (nativeSol != null) wsolSol = 0
  }
  return { configured: true, address, nativeSol, wsolSol }
}

export async function loadPrizeEscrowSolLiability(): Promise<PrizeEscrowSolLiabilitySnapshot> {
  const admin = getSupabaseAdmin()

  const [rafflesRes, auctionsRes] = await Promise.all([
    admin
      .from('raffles')
      .select(
        'prize_amount, prize_currency, prize_type, prize_deposited_at, prize_returned_at, nft_transfer_transaction'
      )
      .eq('prize_type', 'crypto')
      .eq('prize_currency', 'SOL')
      .not('prize_deposited_at', 'is', null)
      .is('prize_returned_at', null)
      .is('nft_transfer_transaction', null),
    admin
      .from('nft_auctions')
      .select('prize_amount, prize_type, prize_deposited_at, prize_claimed_at')
      .eq('prize_type', 'sol')
      .not('prize_deposited_at', 'is', null)
      .is('prize_claimed_at', null),
  ])

  if (rafflesRes.error) {
    throw new Error(`Failed to load SOL raffle prizes: ${rafflesRes.error.message}`)
  }
  if (auctionsRes.error) {
    // Auctions table may be absent in older envs — treat as empty rather than blocking claims.
    console.warn(
      '[prize-escrow-sol-liability] nft_auctions query failed:',
      auctionsRes.error.message
    )
  }

  let raffleSol = 0
  let raffleCount = 0
  for (const row of rafflesRes.data ?? []) {
    if (!raffleSolPrizeBindsEscrow(row)) continue
    const amt = Number(row.prize_amount) || 0
    if (amt <= 0) continue
    raffleSol += amt
    raffleCount += 1
  }

  let auctionSol = 0
  let auctionCount = 0
  for (const row of auctionsRes.data ?? []) {
    if (!auctionSolPrizeBindsEscrow(row)) continue
    const amt = Number(row.prize_amount) || 0
    if (amt <= 0) continue
    auctionSol += amt
    auctionCount += 1
  }

  return computePrizeEscrowSolLiabilitySnapshot({
    unclaimedRaffleSolPrizes: raffleSol,
    unclaimedAuctionSolPrizes: auctionSol,
    raffleCount,
    auctionCount,
  })
}

export async function loadPrizeEscrowSolLiabilityWithCoverage(): Promise<PrizeEscrowSolLiabilityWithCoverage> {
  const [liability, pool] = await Promise.all([
    loadPrizeEscrowSolLiability(),
    getPrizeEscrowSolPoolBalances(),
  ])
  const coverage = evaluatePrizeEscrowSolCoverage({
    nativeSol: pool.nativeSol,
    wsolSol: pool.wsolSol,
    requiredSol: liability.requiredSol,
    feeReserveSol: FEE_RESERVE_SOL,
  })
  return { liability, coverage, pool, feeReserveSol: FEE_RESERVE_SOL }
}

/**
 * Refuse prize-escrow native SOL spends (NFT ATA rent / fees) when they would leave
 * outstanding SOL prizes under-covered. On RPC failure, do not block.
 */
export async function assertPrizeEscrowSolLiabilityCoveredAfterNativeSpend(
  spendSol: number
): Promise<
  | { ok: true; snapshot: PrizeEscrowSolLiabilityWithCoverage }
  | { ok: false; error: string; snapshot: PrizeEscrowSolLiabilityWithCoverage }
> {
  const snapshot = await loadPrizeEscrowSolLiabilityWithCoverage()
  if (!snapshot.pool.configured) {
    return {
      ok: false,
      error: 'Prize escrow is not configured (PRIZE_ESCROW_SECRET_KEY).',
      snapshot,
    }
  }
  if (snapshot.pool.nativeSol == null && snapshot.pool.wsolSol == null) {
    return { ok: true, snapshot }
  }
  const after = evaluatePrizeEscrowSolCoverageAfterNativeSpend({
    nativeSol: snapshot.pool.nativeSol,
    wsolSol: snapshot.pool.wsolSol,
    requiredSol: snapshot.liability.requiredSol,
    spendSol,
    feeReserveSol: snapshot.feeReserveSol,
  })
  if (!after.covered && after.error) {
    return { ok: false, error: after.error, snapshot }
  }
  return { ok: true, snapshot }
}

/** Convenience: gate NFT / ATA creation outflows (~rent + fees). */
export async function assertPrizeEscrowCanFundNftAtaOutflow(): Promise<
  | { ok: true; snapshot: PrizeEscrowSolLiabilityWithCoverage }
  | { ok: false; error: string; snapshot: PrizeEscrowSolLiabilityWithCoverage }
> {
  return assertPrizeEscrowSolLiabilityCoveredAfterNativeSpend(PRIZE_ESCROW_ATA_RENT_SOL)
}
