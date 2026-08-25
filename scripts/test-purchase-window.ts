/**
 * Purchase window: upcoming raffles must not accept ticket buys (cart / API).
 * Run: npx tsx scripts/test-purchase-window.ts
 */
import assert from 'node:assert/strict'
import {
  raffleHasEnded,
  raffleHasStarted,
  raffleIsWithinPurchaseWindow,
  raffleAcceptsTicketPurchases,
  raffleIsDueForWinnerDraw,
  raffleStatusAllowsTicketPurchases,
  raffleWinnerPrizeClaimWindowOpen,
} from '../lib/raffles/purchase-window'
import { raffleCheckoutBlockedReason } from '../lib/cart/validate-raffle-checkout'
import { raffleEligibleForReferralFreeEntry } from '../lib/referrals/program'
import type { Raffle } from '../lib/types'

/** Fixed clock for helpers that accept an explicit `now`. */
const fixedNow = new Date('2026-07-24T12:00:00.000Z')
const fixedPast = '2026-07-24T11:00:00.000Z'
const fixedFuture = '2026-07-24T13:00:00.000Z'
const fixedLater = '2026-07-24T18:00:00.000Z'

assert.equal(raffleHasStarted({ start_time: fixedPast }, fixedNow), true)
assert.equal(raffleHasStarted({ start_time: fixedFuture }, fixedNow), false)
assert.equal(raffleHasStarted({ start_time: '' }, fixedNow), false)
assert.equal(raffleHasEnded({ end_time: fixedPast }, fixedNow), true)
assert.equal(raffleHasEnded({ end_time: fixedLater }, fixedNow), false)

assert.equal(
  raffleIsWithinPurchaseWindow({ start_time: fixedPast, end_time: fixedLater }, fixedNow),
  true
)
assert.equal(
  raffleIsWithinPurchaseWindow({ start_time: fixedFuture, end_time: fixedLater }, fixedNow),
  false,
  'future start must block purchases'
)
assert.equal(
  raffleIsWithinPurchaseWindow({ start_time: fixedPast, end_time: fixedPast }, fixedNow),
  false
)

/** Relative times so client/referral helpers that call `new Date()` stay correct. */
const wallNowMs = Date.now()
const past = new Date(wallNowMs - 60_000).toISOString()
const future = new Date(wallNowMs + 3_600_000).toISOString()
const later = new Date(wallNowMs + 7_200_000).toISOString()

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
    nft_collection_mint: null,
    nft_token_id: null,
    prize_type: 'crypto',
    prize_amount: 1,
    prize_currency: 'SOL',
    ticket_price: 1,
    currency: 'SOL',
    alternate_ticket_currency: null,
    alternate_ticket_price: null,
    max_tickets: null,
    max_tickets_per_wallet: null,
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

assert.equal(raffleStatusAllowsTicketPurchases({ status: 'live' }), true)
assert.equal(raffleStatusAllowsTicketPurchases({ status: 'ready_to_draw' }), false)
assert.equal(raffleStatusAllowsTicketPurchases({ status: 'completed' }), false)

assert.equal(
  raffleAcceptsTicketPurchases(
    { start_time: fixedPast, end_time: fixedLater, status: 'live', is_active: true },
    fixedNow
  ),
  true
)
assert.equal(
  raffleAcceptsTicketPurchases(
    { start_time: fixedPast, end_time: fixedLater, status: 'ready_to_draw', is_active: true },
    fixedNow
  ),
  false,
  'ready_to_draw must not accept ticket purchases even if end_time is in the future'
)

assert.equal(
  raffleIsDueForWinnerDraw({ end_time: fixedLater, status: 'ready_to_draw' }, fixedNow),
  true,
  'ready_to_draw is due for draw even when end_time is still in the future'
)
assert.equal(
  raffleIsDueForWinnerDraw({ end_time: fixedLater, status: 'live' }, fixedNow),
  false
)
assert.equal(
  raffleIsDueForWinnerDraw({ end_time: fixedPast, status: 'live' }, fixedNow),
  true
)

assert.equal(
  raffleWinnerPrizeClaimWindowOpen(
    { end_time: fixedLater, status: 'successful_pending_claims' },
    fixedNow
  ),
  true,
  'sell-out early draw: claim opens while scheduled end_time is still in the future'
)
assert.equal(
  raffleWinnerPrizeClaimWindowOpen({ end_time: fixedLater, status: 'completed' }, fixedNow),
  true
)
assert.equal(
  raffleWinnerPrizeClaimWindowOpen({ end_time: fixedLater, status: 'live' }, fixedNow),
  false,
  'live raffle before end_time is not claimable'
)
assert.equal(
  raffleWinnerPrizeClaimWindowOpen({ end_time: fixedPast, status: 'live' }, fixedNow),
  true,
  'scheduled end still allows claim even if status lagging'
)
assert.equal(
  raffleWinnerPrizeClaimWindowOpen({ end_time: fixedLater, status: 'ready_to_draw' }, fixedNow),
  false,
  'ready_to_draw without draw completion is not a claim window'
)

console.log('purchase-window: ok')
