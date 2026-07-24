/**
 * Purchase window: upcoming raffles must not accept ticket buys (cart / API).
 * Run: npx tsx scripts/test-purchase-window.ts
 */
import assert from 'node:assert/strict'
import {
  raffleHasEnded,
  raffleHasStarted,
  raffleIsWithinPurchaseWindow,
} from '../lib/raffles/purchase-window'
import { raffleCheckoutBlockedReason } from '../lib/cart/validate-raffle-checkout'
import { raffleEligibleForReferralFreeEntry } from '../lib/referrals/program'
import type { Raffle } from '../lib/types'

const now = new Date('2026-07-24T12:00:00.000Z')
const past = '2026-07-24T11:00:00.000Z'
const future = '2026-07-24T13:00:00.000Z'
const later = '2026-07-24T18:00:00.000Z'

assert.equal(raffleHasStarted({ start_time: past }, now), true)
assert.equal(raffleHasStarted({ start_time: future }, now), false)
assert.equal(raffleHasStarted({ start_time: '' }, now), false)
assert.equal(raffleHasEnded({ end_time: past }, now), true)
assert.equal(raffleHasEnded({ end_time: later }, now), false)

assert.equal(
  raffleIsWithinPurchaseWindow({ start_time: past, end_time: later }, now),
  true
)
assert.equal(
  raffleIsWithinPurchaseWindow({ start_time: future, end_time: later }, now),
  false,
  'future start must block purchases'
)
assert.equal(
  raffleIsWithinPurchaseWindow({ start_time: past, end_time: past }, now),
  false
)

function baseRaffle(overrides: Partial<Raffle> = {}): Raffle {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Test',
    slug: 'test',
    description: null,
    image_url: null,
    image_fallback_url: null,
    nft_mint_address: null,
    nft_collection_name: null,
    nft_token_id: null,
    prize_type: 'crypto',
    prize_amount: 1,
    prize_currency: 'SOL',
    ticket_price: 1,
    currency: 'SOL',
    alternate_ticket_currency: null,
    alternate_ticket_price: null,
    max_tickets: null,
    min_tickets: null,
    start_time: past,
    end_time: later,
    original_end_time: null,
    time_extension_count: 0,
    theme_accent: null,
    edited_after_entries: false,
    created_at: past,
    updated_at: past,
    created_by: 'Creator111111111111111111111111111111111',
    creator_wallet: 'Creator111111111111111111111111111111111',
    is_active: true,
    winner_wallet: null,
    winner_selected_at: null,
    status: 'live',
    nft_transfer_transaction: null,
    fee_bps_applied: null,
    fee_tier_reason: null,
    platform_fee_amount: null,
    creator_payout_amount: null,
    settled_at: null,
    rank: null,
    floor_price: null,
    prize_deposited_at: null,
    prize_deposit_tx: null,
    purchases_blocked_at: null,
    ...overrides,
  } as Raffle
}

// Freeze Date.now used by raffleCheckoutBlockedReason / referral helper.
const RealDate = Date
class FakeDate extends RealDate {
  constructor(...args: ConstructorParameters<typeof Date>) {
    if (args.length === 0) {
      super(now.getTime())
    } else {
      // @ts-expect-error spread Date ctor args
      super(...args)
    }
  }
  static now() {
    return now.getTime()
  }
}
// @ts-expect-error test double
globalThis.Date = FakeDate

assert.equal(
  raffleCheckoutBlockedReason(baseRaffle({ start_time: future })),
  'This raffle has not started yet.'
)
assert.equal(raffleCheckoutBlockedReason(baseRaffle({ start_time: past })), null)

assert.equal(
  raffleEligibleForReferralFreeEntry({
    currency: 'SOL',
    is_active: true,
    start_time: future,
    end_time: later,
  }),
  false
)
assert.equal(
  raffleEligibleForReferralFreeEntry({
    currency: 'SOL',
    is_active: true,
    start_time: past,
    end_time: later,
  }),
  true
)

globalThis.Date = RealDate

console.log('purchase-window: ok')
