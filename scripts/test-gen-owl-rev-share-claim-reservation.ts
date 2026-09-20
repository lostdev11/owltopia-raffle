/**
 * Claim reservation release rules (orphan-payout guard).
 * Run: npx tsx scripts/test-gen-owl-rev-share-claim-reservation.ts
 */
import assert from 'node:assert/strict'
import { shouldReleaseRevShareClaimReservation } from '../lib/nesting/gen-owl-rev-share-claim-reservation'

assert.equal(
  shouldReleaseRevShareClaimReservation({
    sol_signature: null,
    usdc_signature: null,
    send_attempted: false,
  }),
  true,
  'pre-send failures may release the reservation'
)

assert.equal(
  shouldReleaseRevShareClaimReservation({
    sol_signature: null,
    usdc_signature: null,
    send_attempted: true,
  }),
  false,
  'ambiguous confirm failures must keep the claim row'
)

assert.equal(
  shouldReleaseRevShareClaimReservation({
    sol_signature: 'sig',
    usdc_signature: null,
    send_attempted: true,
  }),
  false
)

console.log('test-gen-owl-rev-share-claim-reservation: ok')
