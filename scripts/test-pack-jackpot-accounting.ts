/**
 * Jackpot pool accounting from open history (no DB).
 * Run: npx tsx scripts/test-pack-jackpot-accounting.ts
 */
import assert from 'node:assert/strict'
import {
  PACK_JACKPOT_CONTRIBUTION_SOL,
  expectedJackpotPoolSol,
} from '../lib/packs/jackpot'

const rate = PACK_JACKPOT_CONTRIBUTION_SOL

const empty = expectedJackpotPoolSol({ opens: [] })
assert.equal(empty.expectedPoolSol, 0)
assert.equal(empty.completedOpens, 0)

const completedOnly = expectedJackpotPoolSol({
  opens: [
    {
      status: 'completed',
      payment_signature: 'sig1',
      jackpot_contribution_sol: rate,
      is_jackpot_win: false,
      completed_at: '2026-09-10T00:00:00.000Z',
      created_at: '2026-09-10T00:00:00.000Z',
    },
    {
      status: 'completed',
      payment_signature: 'sig2',
      jackpot_contribution_sol: rate,
      is_jackpot_win: false,
      completed_at: '2026-09-11T00:00:00.000Z',
      created_at: '2026-09-11T00:00:00.000Z',
    },
    {
      status: 'pending_payment',
      payment_signature: null,
      jackpot_contribution_sol: null,
      is_jackpot_win: false,
      completed_at: null,
      created_at: '2026-09-12T00:00:00.000Z',
    },
  ],
})
assert.equal(completedOnly.expectedPoolSol, 0.04)
assert.equal(completedOnly.completedOpens, 2)
assert.equal(completedOnly.paidUnfinishedOpens, 0)

const withPaidStuck = expectedJackpotPoolSol({
  contributionSol: rate,
  opens: [
    {
      status: 'completed',
      payment_signature: 'sig1',
      jackpot_contribution_sol: rate,
      is_jackpot_win: false,
      completed_at: '2026-09-10T00:00:00.000Z',
      created_at: '2026-09-10T00:00:00.000Z',
    },
    {
      status: 'completed',
      payment_signature: 'sig2',
      jackpot_contribution_sol: rate,
      is_jackpot_win: false,
      completed_at: '2026-09-11T00:00:00.000Z',
      created_at: '2026-09-11T00:00:00.000Z',
    },
    {
      status: 'refund_needed',
      payment_signature: 'sigStuck',
      jackpot_contribution_sol: null,
      is_jackpot_win: false,
      completed_at: null,
      created_at: '2026-09-15T00:00:00.000Z',
    },
  ],
})
assert.equal(withPaidStuck.expectedPoolSol, 0.06)
assert.equal(withPaidStuck.paidUnfinishedOpens, 1)
assert.equal(withPaidStuck.paidUnfinishedContribSol, rate)

const afterWin = expectedJackpotPoolSol({
  opens: [
    {
      status: 'completed',
      payment_signature: 'old',
      jackpot_contribution_sol: rate,
      is_jackpot_win: false,
      completed_at: '2026-09-01T00:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z',
    },
    {
      status: 'completed',
      payment_signature: 'win',
      jackpot_contribution_sol: rate,
      is_jackpot_win: true,
      completed_at: '2026-09-10T12:00:00.000Z',
      created_at: '2026-09-10T12:00:00.000Z',
    },
    {
      status: 'completed',
      payment_signature: 'after',
      jackpot_contribution_sol: rate,
      is_jackpot_win: false,
      completed_at: '2026-09-11T00:00:00.000Z',
      created_at: '2026-09-11T00:00:00.000Z',
    },
    {
      status: 'refund_needed',
      payment_signature: 'stuckAfter',
      jackpot_contribution_sol: null,
      is_jackpot_win: false,
      completed_at: null,
      created_at: '2026-09-12T00:00:00.000Z',
    },
  ],
})
assert.equal(afterWin.sinceJackpotWinAt, '2026-09-10T12:00:00.000Z')
assert.equal(afterWin.expectedPoolSol, 0.04)
assert.equal(afterWin.completedOpens, 1)
assert.equal(afterWin.paidUnfinishedOpens, 1)

console.log('pack-jackpot-accounting: ok')
