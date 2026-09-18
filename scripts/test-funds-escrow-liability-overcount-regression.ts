/**
 * Regression: PR #236 global gate must not require ~8 SOL when real SOL liability ~0.8–1.0.
 * Run: npm run test:funds-escrow-liability-overcount-regression
 */
import assert from 'node:assert/strict'
import {
  computeFundsEscrowLiabilitySnapshot,
  emptyFundsEscrowCurrencyBucket,
  evaluateFundsEscrowCoverage,
  unsettledRaffleSettlementLiability,
  addToFundsEscrowBucket,
} from '../lib/raffles/funds-escrow-liability'

/** Production-shaped fixture (Sep 2026): 16 SOL escrow raffles in successful_pending_claims. */
const PRODUCTION_SOL_RAFFLES = [
  // 12 hosts already claimed creator proceeds — only platform fee remains (~0.012 each).
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `claimed-${i}`,
    currency: 'SOL',
    creator_payout_amount: 0.34,
    platform_fee_amount: 0.012,
    creator_claimed_at: '2026-09-10T12:00:00.000Z',
    platform_fee_settled_at: null as string | null,
  })),
  // 4 still owe full settlement (owl-944 class hosts).
  {
    id: '79ee22a3-e53b-4b37-b317-75dfe744bf3c',
    currency: 'SOL',
    creator_payout_amount: 0.4481,
    platform_fee_amount: 0.014,
    creator_claimed_at: null,
    platform_fee_settled_at: null,
  },
  {
    id: 'uas-labs',
    currency: 'SOL',
    creator_payout_amount: 0.3,
    platform_fee_amount: 0.01,
    creator_claimed_at: null,
    platform_fee_settled_at: null,
  },
  {
    id: 'pg1mt',
    currency: 'SOL',
    creator_payout_amount: 0.038,
    platform_fee_amount: 0.002,
    creator_claimed_at: null,
    platform_fee_settled_at: null,
  },
  {
    id: 'fourth-pending',
    currency: 'SOL',
    creator_payout_amount: 0.026,
    platform_fee_amount: 0.001,
    creator_claimed_at: null,
    platform_fee_settled_at: null,
  },
]

function sumFullCreatorAndFee(
  rows: typeof PRODUCTION_SOL_RAFFLES
): number {
  return rows.reduce(
    (acc, r) => acc + (Number(r.creator_payout_amount) || 0) + (Number(r.platform_fee_amount) || 0),
    0
  )
}

function sumUnsettledSettlement(
  rows: typeof PRODUCTION_SOL_RAFFLES
): number {
  return rows.reduce((acc, r) => acc + unsettledRaffleSettlementLiability(r).total, 0)
}

const buggyAllInFull = sumFullCreatorAndFee(PRODUCTION_SOL_RAFFLES)
const correctUnsettled = sumUnsettledSettlement(PRODUCTION_SOL_RAFFLES)

assert.ok(buggyAllInFull > 4.5, `fixture should reproduce ~5 SOL bogus full sum, got ${buggyAllInFull}`)
assert.ok(
  correctUnsettled > 0.75 && correctUnsettled < 1.15,
  `correct unsettled SOL should be ~0.8–1.0, got ${correctUnsettled}`
)
assert.ok(
  buggyAllInFull - correctUnsettled > 3.5,
  `fixture should show ~4 SOL creator double-count removed, delta=${buggyAllInFull - correctUnsettled}`
)

const unclaimed = emptyFundsEscrowCurrencyBucket()
for (const row of PRODUCTION_SOL_RAFFLES) {
  const { total } = unsettledRaffleSettlementLiability(row)
  if (total <= 0) continue
  addToFundsEscrowBucket(unclaimed, row.currency, total)
}

const snap = computeFundsEscrowLiabilitySnapshot({
  unclaimedRaffleSettlements: unclaimed,
  refundableTicketEntries: emptyFundsEscrowCurrencyBucket(),
  openBuyoutDeposits: emptyFundsEscrowCurrencyBucket(),
  unclaimedAuctionSettlements: emptyFundsEscrowCurrencyBucket(),
  openAuctionBids: emptyFundsEscrowCurrencyBucket(),
  milestoneCryptoHeld: emptyFundsEscrowCurrencyBucket(),
  counts: {
    unclaimedRaffleSettlements: PRODUCTION_SOL_RAFFLES.filter(
      (r) => unsettledRaffleSettlementLiability(r).total > 0
    ).length,
    refundableTicketEntries: 0,
    openBuyoutDeposits: 0,
    unclaimedAuctionSettlements: 0,
    openAuctionBids: 0,
    milestoneCryptoHeld: 0,
  },
})

assert.ok(Math.abs(snap.required.sol - correctUnsettled) < 1e-9)

/** Mikeey owl-944: ~1.02687 SOL on-chain vs ~0.8–1.0 real liability should pass the gate. */
const coverage = evaluateFundsEscrowCoverage({
  hold: {
    configured: true,
    address: 'Escrow',
    sol: 1.02687,
    usdc: 0,
    owl: 0,
    bamboo: 0,
    goats: 0,
  },
  required: snap.required,
  feeReserveSol: 0.002,
})
assert.equal(coverage.covered, true, coverage.error ?? 'expected covered')
assert.equal(coverage.error, null)

/** Bogus ~8 SOL required (5.04 settlements + ~3 other) must fail against real hold. */
const bogusRequired = emptyFundsEscrowCurrencyBucket()
addToFundsEscrowBucket(bogusRequired, 'SOL', buggyAllInFull + 3.03)
const bogus = evaluateFundsEscrowCoverage({
  hold: {
    configured: true,
    address: 'Escrow',
    sol: 1.02687,
    usdc: 0,
    owl: 0,
    bamboo: 0,
    goats: 0,
  },
  required: bogusRequired,
  feeReserveSol: 0.002,
})
assert.equal(bogus.covered, false)
assert.ok(bogus.shortfall.sol > 6, `bogus gate should show large SOL shortfall, got ${bogus.shortfall.sol}`)

console.log('ok: funds-escrow liability regression (unsettled settlements, ~1 SOL hold passes)')
