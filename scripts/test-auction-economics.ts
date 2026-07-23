import assert from 'node:assert/strict'
import { isReserveMet, minNextBidAmount } from '../lib/auctions/economics'

assert.equal(
  minNextBidAmount({ start_price: 1, current_bid_amount: null, bid_currency: 'SOL' }),
  1
)

assert.equal(
  minNextBidAmount({ start_price: 1, current_bid_amount: 1, bid_currency: 'SOL' }),
  1.05
)

assert.equal(
  minNextBidAmount({ start_price: 0.05, current_bid_amount: 0.05, bid_currency: 'SOL' }),
  0.06
)

assert.equal(isReserveMet({ reserve_price: null, current_bid_amount: 1 }), true)
assert.equal(isReserveMet({ reserve_price: 2, current_bid_amount: 1.5 }), false)
assert.equal(isReserveMet({ reserve_price: 2, current_bid_amount: 2 }), true)

console.log('auctions economics ok')
