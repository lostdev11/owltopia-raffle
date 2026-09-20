/**
 * Unit tests for fair multi-VRF cron scheduling (draw-ended-raffles).
 * Run: npx tsx scripts/test-draw-ended-scheduler.ts
 */
import assert from 'node:assert/strict'
import {
  classifyEndedRaffleWork,
  cronRotationRank,
  DRAW_ENDED_MIN_MS_FOR_FULL_VRF,
  endedRaffleDueSortKey,
  hashCronRotationKey,
  orderEndedRafflesForCron,
  raffleLikelyNeedsVrfDraw,
  remainingDrawCronBudgetMs,
  resolveRevealWaitMsForCronBudget,
  shouldStartFullVrfAttempt,
  shouldStartVrfResumeAttempt,
} from '../lib/raffles/draw-ended-scheduler'
import type { Raffle } from '../lib/types'
import {
  isRetryableVrfRevealError,
  isSwitchboardOracleFleetUnavailableError,
  shouldAutoForceNewVrfRequest,
} from '../lib/raffles/draw/vrf-retry-policy'
import { isSwitchboardOracleFleetUnavailable } from '../lib/raffles/draw/vrf-oracle-select'

function stubRaffle(partial: Partial<Raffle> & { id: string; title: string }): Raffle {
  return {
    slug: partial.id,
    description: null,
    image_url: null,
    ticket_price: 1,
    currency: 'OWL',
    max_tickets: 100,
    min_tickets: 1,
    start_time: '2026-09-01T00:00:00.000Z',
    end_time: '2026-09-20T00:00:00.000Z',
    status: 'ready_to_draw',
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...partial,
  } as Raffle
}

assert.equal(hashCronRotationKey('a') === hashCronRotationKey('a'), true)
assert.equal(hashCronRotationKey('a') === hashCronRotationKey('b'), false)

const slotA = cronRotationRank('raffle-a', 0)
const slotB = cronRotationRank('raffle-b', 0)
assert.equal(typeof slotA, 'number')
assert.equal(cronRotationRank('raffle-a', 0), slotA)
// Different cron slots should reshuffle ranks for the same id.
assert.notEqual(
  cronRotationRank('raffle-a', 0),
  cronRotationRank('raffle-a', 15 * 60_000)
)

const vrfA = stubRaffle({
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  title: 'VRF A',
  draw_algo: 'owltopia-draw-v3-vrf',
  end_time: '2026-09-20T10:00:00.000Z',
  draw_vrf_requested_at: '2026-09-20T10:01:00.000Z',
})
const vrfB = stubRaffle({
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  title: 'VRF B',
  draw_algo: 'owltopia-draw-v3-vrf',
  end_time: '2026-09-20T10:03:00.000Z',
  draw_vrf_requested_at: '2026-09-20T10:04:00.000Z',
})
const fast = stubRaffle({
  id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  title: 'Fast extend',
  draw_algo: 'owltopia-draw-v2-commit-reveal',
  draw_commit_hash: 'abc',
  end_time: '2026-09-20T12:00:00.000Z',
})

assert.equal(raffleLikelyNeedsVrfDraw(vrfA), true)
assert.equal(raffleLikelyNeedsVrfDraw(fast), false)
assert.equal(classifyEndedRaffleWork(vrfA), 'vrf_full')
assert.equal(
  classifyEndedRaffleWork({
    ...vrfA,
    draw_vrf_account: 'Rand111111111111111111111111111111111111111',
    draw_vrf_status: 'pending',
  }),
  'vrf_resume'
)
assert.equal(classifyEndedRaffleWork(fast), 'fast')

assert.ok(endedRaffleDueSortKey(vrfA) < endedRaffleDueSortKey(vrfB))

const ordered0 = orderEndedRafflesForCron([vrfB, fast, vrfA], 0)
assert.equal(ordered0[0]!.id, fast.id, 'fast non-VRF work runs before VRF')
assert.equal(ordered0.length, 3)

const firstAt0 = orderEndedRafflesForCron([vrfA, vrfB], 0).map((r) => r.id)
const firstAtSlot2 = orderEndedRafflesForCron([vrfA, vrfB], 2 * 15 * 60_000).map((r) => r.id)
// Across two slots, rotation should not always prefer the same first VRF raffle
// (hash collision possible but extremely unlikely for these fixed UUIDs).
assert.ok(
  firstAt0[0] !== firstAtSlot2[0] || firstAt0[1] !== firstAtSlot2[1],
  'rotation should reshuffle VRF order across cron slots'
)

assert.equal(
  shouldStartFullVrfAttempt({ fullVrfAttemptsSoFar: 0, remainingMs: DRAW_ENDED_MIN_MS_FOR_FULL_VRF }),
  true
)
assert.equal(
  shouldStartFullVrfAttempt({ fullVrfAttemptsSoFar: 0, remainingMs: DRAW_ENDED_MIN_MS_FOR_FULL_VRF - 1 }),
  false
)
assert.equal(
  shouldStartFullVrfAttempt({ fullVrfAttemptsSoFar: 1, remainingMs: 100_000 }),
  false,
  'second full VRF in same tick must be deferred'
)
assert.equal(shouldStartVrfResumeAttempt({ remainingMs: 15_000 }), true)
assert.equal(shouldStartVrfResumeAttempt({ remainingMs: 14_999 }), false)

assert.equal(remainingDrawCronBudgetMs({ startedAtMs: 0, softBudgetMs: 110_000, nowMs: 20_000 }), 90_000)
assert.ok(resolveRevealWaitMsForCronBudget(100_000) <= 75_000)
assert.ok(resolveRevealWaitMsForCronBudget(20_000) >= 10_000)

const oracleErr = 'No eligible randomness oracle candidates were found'
assert.equal(isSwitchboardOracleFleetUnavailableError(oracleErr), true)
assert.equal(isSwitchboardOracleFleetUnavailable(oracleErr), true)
assert.equal(isRetryableVrfRevealError(oracleErr), true)
assert.equal(
  shouldAutoForceNewVrfRequest({
    drawVrfStatus: 'failed',
    drawVrfAccount: 'Rand111111111111111111111111111111111111111',
    drawVrfError: oracleErr,
    drawVrfRequestedAt: '2026-09-20T12:30:00.000Z',
    nowMs: Date.parse('2026-09-20T12:30:30.000Z'),
  }),
  true,
  'oracle-fleet errors should force a fresh commit promptly'
)

console.log('test-draw-ended-scheduler: ok')
