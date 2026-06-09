/**
 * Cart restore invariant: lines whose payment was broadcast on-chain but not yet
 * verified must NEVER be restored into the cart (double-payment footgun on mobile
 * retry); unattempted lines must be restored; settled lines are removed.
 * Run: npx tsx scripts/test-cart-checkout-restore.ts
 */
import assert from 'node:assert/strict'
import { computeCartLinesAfterBatchCheckout } from '../lib/cart/checkout-restore'
import type { CartLine } from '../lib/cart/types'

function line(raffleId: string): CartLine {
  return {
    raffleId,
    quantity: 2,
    addedAt: Date.now(),
    snapshot: { title: `Raffle ${raffleId}`, slug: `raffle-${raffleId}`, currency: 'SOL', ticket_price: 0.1 },
  }
}

const cart = [line('a'), line('b'), line('c'), line('d')]

// Pre-payment failure: nothing settled, nothing paid → full cart restored.
assert.deepEqual(
  computeCartLinesAfterBatchCheckout(cart, [], []).map(l => l.raffleId),
  ['a', 'b', 'c', 'd']
)

// Mobile wallet edge case: batch 1 (a, b) verified; batch 2 (c) paid on-chain but
// verify dropped when the tab was backgrounded; batch 3 (d) never attempted.
// Only the unattempted line may return to the cart.
const after = computeCartLinesAfterBatchCheckout(cart, ['a', 'b'], ['c'])
assert.deepEqual(after.map(l => l.raffleId), ['d'])

// Full success → cart empty.
assert.deepEqual(computeCartLinesAfterBatchCheckout(cart, ['a', 'b', 'c', 'd'], []), [])

// Paid-but-unverified alone is still removed (single-line fallback path).
assert.deepEqual(
  computeCartLinesAfterBatchCheckout([line('x')], [], ['x']),
  []
)

// IDs not present in the cart are ignored.
assert.deepEqual(
  computeCartLinesAfterBatchCheckout(cart, ['zz'], ['yy']).map(l => l.raffleId),
  ['a', 'b', 'c', 'd']
)

console.log('cart-checkout-restore: ok')
