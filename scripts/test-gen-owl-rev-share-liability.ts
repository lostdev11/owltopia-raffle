/**
 * Claimed vs unclaimed rev-share liability + pool coverage.
 * Run: npx tsx scripts/test-gen-owl-rev-share-liability.ts
 */
import assert from 'node:assert/strict'
import type { GenOwlRevSharePeriodRow } from '../lib/db/gen-owl-rev-share-periods'
import {
  computeGenOwlRevShareLiabilitySnapshot,
  evaluateGenOwlRevSharePoolCoverage,
  paidAmountsFromClaim,
} from '../lib/nesting/gen-owl-rev-share-liability'

function period(
  month: string,
  opts: {
    gen1Sol?: number
    gen2Sol?: number
    gen1Usdc?: number
    gen2Usdc?: number
    gen1Eligible?: number
    gen2Eligible?: number
    finalized?: boolean
  }
): GenOwlRevSharePeriodRow {
  return {
    period_month: month,
    gen1_total_sol: opts.gen1Sol ?? null,
    gen1_total_usdc: opts.gen1Usdc ?? null,
    gen2_total_sol: opts.gen2Sol ?? null,
    gen2_total_usdc: opts.gen2Usdc ?? null,
    gen1_eligible_count: opts.gen1Eligible ?? null,
    gen2_eligible_count: opts.gen2Eligible ?? null,
    gen1_standard_eligible_count: null,
    gen1_one_of_one_eligible_count: null,
    gen2_standard_eligible_count: null,
    gen2_one_of_one_eligible_count: null,
    gen1_per_nest_sol: null,
    gen1_per_nest_usdc: null,
    gen1_standard_per_nest_sol: null,
    gen1_standard_per_nest_usdc: null,
    gen1_one_of_one_per_nest_sol: null,
    gen1_one_of_one_per_nest_usdc: null,
    gen2_per_nest_sol: null,
    gen2_per_nest_usdc: null,
    gen2_standard_per_nest_sol: null,
    gen2_standard_per_nest_usdc: null,
    gen2_one_of_one_per_nest_sol: null,
    gen2_one_of_one_per_nest_usdc: null,
    finalized_at: opts.finalized === false ? null : '2026-07-31T00:00:00.000Z',
    updated_at: '2026-07-31T00:00:00.000Z',
  }
}

const paid = paidAmountsFromClaim({
  amount_sol: 0.01,
  amount_usdc: 0,
  sol_transaction_signature: 'sig',
  usdc_transaction_signature: null,
})
assert.equal(paid.paid_sol, 0.01)
assert.equal(paid.fully_paid, true)

const unpaid = paidAmountsFromClaim({
  amount_sol: 0.01,
  amount_usdc: 0,
  sol_transaction_signature: null,
  usdc_transaction_signature: null,
})
assert.equal(unpaid.paid_sol, 0)
assert.equal(unpaid.fully_paid, false)

// Two stacked open months: July mostly claimed, August barely claimed.
// now = Sep 5 2026 → July + August claim windows are open.
const now = new Date(Date.UTC(2026, 8, 5, 12, 0, 0))
const snap = computeGenOwlRevShareLiabilitySnapshot({
  now,
  periods: [
    period('2026-08', { gen1Sol: 10, gen2Sol: 5, gen1Eligible: 100, gen2Eligible: 50 }),
    period('2026-07', { gen1Sol: 8, gen2Sol: 2, gen1Eligible: 80, gen2Eligible: 20 }),
  ],
  claims: [
    // July: 90 nests claimed @ 0.1 SOL → paid 9 of 10 SOL
    ...Array.from({ length: 90 }, () => ({
      period_month: '2026-07',
      amount_sol: 0.1,
      amount_usdc: 0,
      sol_transaction_signature: 'july-paid',
      usdc_transaction_signature: null,
    })),
    // August: 20 nests claimed @ 0.1 SOL → paid 2 of 15 SOL
    ...Array.from({ length: 20 }, () => ({
      period_month: '2026-08',
      amount_sol: 0.1,
      amount_usdc: 0,
      sol_transaction_signature: 'aug-paid',
      usdc_transaction_signature: null,
    })),
  ],
})

assert.equal(snap.open.open_period_count, 2)
assert.equal(snap.open.deposited_sol, 25)
assert.ok(Math.abs(snap.open.paid_sol - 11) < 1e-9)
assert.ok(Math.abs(snap.open.unclaimed_sol - 14) < 1e-9)
assert.equal(snap.open.eligible_nests, 250)
assert.equal(snap.open.claimed_nests, 110)
assert.equal(snap.open.unclaimed_nests, 140)
assert.ok(snap.open.required_sol > snap.open.unclaimed_sol) // includes fee reserve

const july = snap.periods.find((p) => p.period_month === '2026-07')!
assert.equal(july.claimed_nests, 90)
assert.equal(july.unclaimed_nests, 10)
assert.ok(Math.abs(july.unclaimed_sol - 1) < 1e-9)

const covered = evaluateGenOwlRevSharePoolCoverage({
  hold_sol: snap.open.required_sol,
  hold_usdc: 0,
  required_sol: snap.open.required_sol,
  required_usdc: snap.open.required_usdc,
  unclaimed_nests: snap.open.unclaimed_nests,
  open_period_count: snap.open.open_period_count,
})
assert.equal(covered.ok, true)

const short = evaluateGenOwlRevSharePoolCoverage({
  hold_sol: 0.00929,
  hold_usdc: 0,
  required_sol: snap.open.required_sol,
  required_usdc: 0,
  unclaimed_nests: snap.open.unclaimed_nests,
  open_period_count: snap.open.open_period_count,
})
assert.equal(short.ok, false)
assert.ok(short.shortfall_sol > 13)
assert.match(short.error ?? '', /unclaimed nest/i)

console.log('test-gen-owl-rev-share-liability: ok')
