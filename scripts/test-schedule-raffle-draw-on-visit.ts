/**
 * Run: npx tsx scripts/test-schedule-raffle-draw-on-visit.ts
 */
import assert from 'node:assert/strict'
import type { Raffle } from '@/lib/types'

// Mirror private predicate from schedule-raffle-draw-on-visit.ts for unit checks.
function raffleMayAutoDrawOnVisit(raffle: Pick<Raffle, 'winner_wallet' | 'winner_selected_at' | 'status' | 'prize_deposited_at' | 'prize_type'>): boolean {
  if (raffle.winner_wallet || raffle.winner_selected_at) return false
  const status = (raffle.status ?? '').trim().toLowerCase()
  if (status !== 'live' && status !== 'ready_to_draw' && status !== 'pending_min_not_met') {
    return false
  }
  const needsEscrow = raffle.prize_type === 'nft'
  if (needsEscrow && !raffle.prize_deposited_at) return false
  return true
}

const base = {
  winner_wallet: null,
  winner_selected_at: null,
  status: 'live' as const,
  prize_type: 'nft' as const,
  prize_deposited_at: '2024-01-01T00:00:00Z',
}

assert.equal(raffleMayAutoDrawOnVisit(base), true, 'live nft with escrow')
assert.equal(
  raffleMayAutoDrawOnVisit({ ...base, status: 'ready_to_draw' }),
  true,
  'ready_to_draw schedules'
)
assert.equal(
  raffleMayAutoDrawOnVisit({ ...base, winner_wallet: 'abc' }),
  false,
  'already has winner'
)
assert.equal(
  raffleMayAutoDrawOnVisit({ ...base, prize_deposited_at: null }),
  false,
  'nft without escrow'
)
assert.equal(
  raffleMayAutoDrawOnVisit({ ...base, status: 'completed' }),
  false,
  'completed skipped'
)

console.log('test-schedule-raffle-draw-on-visit: ok')
