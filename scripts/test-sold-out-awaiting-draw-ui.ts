/**
 * Sold-out awaiting draw UI helper.
 * Run: npx tsx scripts/test-sold-out-awaiting-draw-ui.ts
 */
import assert from 'node:assert/strict'
import { raffleIsSoldOutAwaitingDraw } from '../lib/raffles/sold-out-copy'

const base = {
  max_tickets: 100,
  winner_wallet: null,
  winner_selected_at: null,
}

assert.equal(
  raffleIsSoldOutAwaitingDraw({ ...base, status: 'live' }, 0),
  true,
  'live + sold out at max'
)
assert.equal(
  raffleIsSoldOutAwaitingDraw({ ...base, status: 'ready_to_draw' }, 0),
  true,
  'ready_to_draw before end is draw pending'
)
assert.equal(
  raffleIsSoldOutAwaitingDraw({ ...base, status: 'ready_to_draw' }, 5),
  false,
  'not sold out'
)
assert.equal(
  raffleIsSoldOutAwaitingDraw({ ...base, status: 'live', max_tickets: null }, 0),
  false,
  'legacy unlimited not sold-out-awaiting'
)

console.log('sold-out-awaiting-draw-ui: ok')
