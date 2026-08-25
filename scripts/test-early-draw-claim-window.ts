/**
 * Sell-out early draw must open winner prize claims before scheduled end_time.
 * Run: npx tsx scripts/test-early-draw-claim-window.ts
 */
import assert from 'node:assert/strict'
import { raffleWinnerPrizeClaimWindowOpen } from '../lib/raffles/purchase-window'

const fixedNow = new Date('2026-07-24T12:00:00.000Z')
const fixedPast = '2026-07-24T11:00:00.000Z'
const fixedLater = '2026-07-24T18:00:00.000Z'

assert.equal(
  raffleWinnerPrizeClaimWindowOpen(
    { end_time: fixedLater, status: 'successful_pending_claims' },
    fixedNow
  ),
  true,
  'early draw: successful_pending_claims before end_time is claimable'
)

assert.equal(
  raffleWinnerPrizeClaimWindowOpen({ end_time: fixedLater, status: 'completed' }, fixedNow),
  true
)

assert.equal(
  raffleWinnerPrizeClaimWindowOpen({ end_time: fixedLater, status: 'live' }, fixedNow),
  false
)

assert.equal(
  raffleWinnerPrizeClaimWindowOpen({ end_time: fixedPast, status: 'live' }, fixedNow),
  true
)

assert.equal(
  raffleWinnerPrizeClaimWindowOpen({ end_time: fixedLater, status: 'ready_to_draw' }, fixedNow),
  false
)

console.log('early-draw-claim-window: ok')
