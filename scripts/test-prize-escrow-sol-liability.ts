/**
 * Prize-escrow SOL liability coverage — refuse NFT outflows that strand SOL prizes.
 * Run: npx tsx scripts/test-prize-escrow-sol-liability.ts
 */
import assert from 'node:assert/strict'
import {
  auctionSolPrizeBindsEscrow,
  computePrizeEscrowSolLiabilitySnapshot,
  evaluatePrizeEscrowSolCoverage,
  evaluatePrizeEscrowSolCoverageAfterNativeSpend,
  raffleSolPrizeBindsEscrow,
} from '../lib/raffles/prize-escrow-sol-liability'

assert.equal(
  raffleSolPrizeBindsEscrow({
    prize_type: 'crypto',
    prize_currency: 'SOL',
    prize_deposited_at: '2026-09-01T00:00:00.000Z',
    prize_returned_at: null,
    nft_transfer_transaction: null,
  }),
  true
)
assert.equal(
  raffleSolPrizeBindsEscrow({
    prize_type: 'crypto',
    prize_currency: 'SOL',
    prize_deposited_at: '2026-09-01T00:00:00.000Z',
    prize_returned_at: null,
    nft_transfer_transaction: 'sig123',
  }),
  false,
  'claimed SOL prize must not bind liability'
)
assert.equal(
  raffleSolPrizeBindsEscrow({
    prize_type: 'nft',
    prize_currency: null,
    prize_deposited_at: '2026-09-01T00:00:00.000Z',
  }),
  false
)
assert.equal(
  auctionSolPrizeBindsEscrow({
    prize_type: 'sol',
    prize_deposited_at: '2026-09-01T00:00:00.000Z',
    prize_claimed_at: null,
  }),
  true
)
assert.equal(
  auctionSolPrizeBindsEscrow({
    prize_type: 'sol',
    prize_deposited_at: '2026-09-01T00:00:00.000Z',
    prize_claimed_at: '2026-09-02T00:00:00.000Z',
  }),
  false
)

const snap = computePrizeEscrowSolLiabilitySnapshot({
  unclaimedRaffleSolPrizes: 1,
  unclaimedAuctionSolPrizes: 0.5,
  raffleCount: 1,
  auctionCount: 1,
})
assert.equal(snap.requiredSol, 1.5)
assert.equal(snap.counts.unclaimedRaffleSolPrizes, 1)

const covered = evaluatePrizeEscrowSolCoverage({
  nativeSol: 0.52,
  wsolSol: 1.0,
  requiredSol: 1.0,
})
assert.equal(covered.covered, true)

const short = evaluatePrizeEscrowSolCoverage({
  nativeSol: 0.5209,
  wsolSol: 0,
  requiredSol: 1.0,
})
assert.equal(short.covered, false)
assert.ok(short.shortfallSol > 0.47)
assert.ok(short.error?.includes('shortfall'))

// NFT ATA rent (~0.002) must not be allowed when it would leave SOL prizes uncovered
const afterAta = evaluatePrizeEscrowSolCoverageAfterNativeSpend({
  nativeSol: 1.001,
  wsolSol: 0,
  requiredSol: 1.0,
  spendSol: 0.00204,
})
assert.equal(afterAta.covered, false, 'ATA rent must not strand a 1 SOL native prize')

const afterAtaOk = evaluatePrizeEscrowSolCoverageAfterNativeSpend({
  nativeSol: 0.01,
  wsolSol: 1.0,
  requiredSol: 1.0,
  spendSol: 0.00204,
})
assert.equal(afterAtaOk.covered, true, 'wSOL-segregated prizes survive native ATA rent')

// Reproduce the claim sim failure: ~1.0001 SOL cannot pay 1 SOL + fee and stay rent-exempt.
const prizeLamports = 1_000_000_000n
const feeBuffer = 5_000n
const rentExempt = 650_240n // live mainnet getMinimumBalanceForRentExemption(0)
const have = 1_000_096_490n
const neededWithRent = prizeLamports + feeBuffer + rentExempt
assert.equal(have < neededWithRent, true, 'topped-up escrow still short rent reserve')
assert.equal(neededWithRent - have, 558_750n)

const neededFeeOnly = prizeLamports + feeBuffer
assert.equal(have >= neededFeeOnly, true, 'old fee-only check would incorrectly allow payout')

console.log('ok: prize-escrow SOL liability coverage + rent-aware native payout preflight')
