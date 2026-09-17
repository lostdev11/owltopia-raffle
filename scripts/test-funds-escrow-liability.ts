/**
 * Funds-escrow liability coverage evaluation (pure math).
 * Run: npx tsx scripts/test-funds-escrow-liability.ts
 */
import assert from 'node:assert/strict'
import {
  computeFundsEscrowLiabilitySnapshot,
  emptyFundsEscrowCurrencyBucket,
  evaluateFundsEscrowCoverage,
  addToFundsEscrowBucket,
} from '../lib/raffles/funds-escrow-liability'

const unclaimed = emptyFundsEscrowCurrencyBucket()
addToFundsEscrowBucket(unclaimed, 'SOL', 0.462)

const snap = computeFundsEscrowLiabilitySnapshot({
  unclaimedRaffleSettlements: unclaimed,
  refundableTicketEntries: emptyFundsEscrowCurrencyBucket(),
  openBuyoutDeposits: emptyFundsEscrowCurrencyBucket(),
  unclaimedAuctionSettlements: emptyFundsEscrowCurrencyBucket(),
  openAuctionBids: emptyFundsEscrowCurrencyBucket(),
  milestoneCryptoHeld: emptyFundsEscrowCurrencyBucket(),
  counts: {
    unclaimedRaffleSettlements: 1,
    refundableTicketEntries: 0,
    openBuyoutDeposits: 0,
    unclaimedAuctionSettlements: 0,
    openAuctionBids: 0,
    milestoneCryptoHeld: 0,
  },
})

assert.ok(Math.abs(snap.required.sol - 0.462) < 1e-9)

const short = evaluateFundsEscrowCoverage({
  hold: {
    configured: true,
    address: 'Escrow',
    sol: 0.00588,
    usdc: 0,
    owl: 0,
    bamboo: 0,
    goats: 0,
  },
  required: snap.required,
  feeReserveSol: 0.002,
})
assert.equal(short.covered, false)
assert.ok(short.error && /cannot cover outstanding liability/i.test(short.error))
assert.ok(short.shortfall.sol > 0.45)

const ok = evaluateFundsEscrowCoverage({
  hold: {
    configured: true,
    address: 'Escrow',
    sol: 1,
    usdc: 0,
    owl: 0,
    bamboo: 0,
    goats: 0,
  },
  required: snap.required,
  feeReserveSol: 0.002,
})
assert.equal(ok.covered, true)
assert.equal(ok.error, null)

console.log('ok: funds-escrow liability coverage refuses underfunded shared wallet')
