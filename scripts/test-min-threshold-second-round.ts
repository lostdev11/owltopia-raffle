/**
 * Regression checks for min-threshold flow: first end misses threshold → one extension (2nd selling round);
 * second end with threshold met → eligible to draw (via canSelectWinner), no extra time gate.
 *
 * Run: npx --yes tsx scripts/test-min-threshold-second-round.ts
 */
import assert from 'node:assert/strict'

import type { Raffle, Entry } from '../lib/types'
import {
  canSelectWinner,
  isRaffleEligibleToDraw,
  calculateTicketsSold,
} from '../lib/db/raffles'
import { hasExhaustedMinThresholdTimeExtensions } from '../lib/raffles/ticket-escrow-policy'
import { buildMinThresholdMissExtensionPatch } from '../lib/raffles/min-threshold-extension'

function entry(q: number): Entry {
  return {
    id: 'e1',
    raffle_id: 'r1',
    wallet_address: 'W1',
    ticket_quantity: q,
    status: 'confirmed',
    refunded_at: null,
  } as Entry
}

function baseRaffle(over: Partial<Raffle>): Raffle {
  const start = new Date('2025-01-01T00:00:00.000Z').toISOString()
  const end = new Date('2025-01-08T00:00:00.000Z').toISOString()
  return {
    id: 'r1',
    slug: 'test',
    title: 'Test',
    start_time: start,
    end_time: end,
    original_end_time: null,
    time_extension_count: 0,
    min_tickets: 100,
    prize_type: 'crypto',
    status: 'live',
    ...over,
  } as Raffle
}

async function main() {
  const raffle = baseRaffle({})
  const entriesLow: Entry[] = [entry(40)]
  const entriesOk: Entry[] = [entry(100)]

  assert.equal(isRaffleEligibleToDraw(raffle, entriesLow), false)
  assert.equal(canSelectWinner(raffle, entriesLow), false)
  assert.equal(hasExhaustedMinThresholdTimeExtensions(raffle), false)

  const patch = buildMinThresholdMissExtensionPatch(raffle)
  assert.equal(patch.time_extension_count, 1)
  assert.equal(patch.status, 'live')
  assert.equal(patch.is_active, true)
  assert.ok(patch.original_end_time === raffle.end_time)

  const extendedEndMs = new Date(patch.end_time).getTime()
  const prevEndMs = new Date(raffle.end_time).getTime()
  const expectedDelta = 7 * 24 * 60 * 60 * 1000
  assert.equal(extendedEndMs - prevEndMs, expectedDelta, '7-day fallback when start/end sane')

  const afterExtend = {
    ...raffle,
    original_end_time: patch.original_end_time,
    end_time: patch.end_time,
    time_extension_count: patch.time_extension_count,
  }

  assert.equal(hasExhaustedMinThresholdTimeExtensions(afterExtend), true)

  // 2nd round: threshold met → draw allowed (same rules as round 1 would have been if threshold met)
  assert.equal(calculateTicketsSold(entriesOk), 100)
  assert.equal(isRaffleEligibleToDraw(afterExtend, entriesOk), true)
  assert.equal(canSelectWinner(afterExtend, entriesOk), true)

  console.log('min-threshold second round checks: OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
