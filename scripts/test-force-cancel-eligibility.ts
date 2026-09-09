/**
 * Force-cancel eligibility for live milestone raffles without creator request.
 *
 * Run: npx --yes tsx scripts/test-force-cancel-eligibility.ts
 */
import assert from 'node:assert/strict'

import { canAdminForceCancelMilestoneRaffle } from '../lib/raffles/force-cancel-eligibility'

function main() {
  const base = {
    status: 'live',
    milestoneCount: 2,
    cancellationRequestedAt: null,
    cancellationFeePaidAt: null,
    cancelledAt: null,
    winnerWallet: null,
    winnerSelectedAt: null,
  }

  assert.equal(canAdminForceCancelMilestoneRaffle(base), true, 'Captain Solana case')

  assert.equal(
    canAdminForceCancelMilestoneRaffle({ ...base, milestoneCount: 0 }),
    false,
    'non-milestone raffles use accept-cancellation only'
  )

  assert.equal(
    canAdminForceCancelMilestoneRaffle({
      ...base,
      cancellationRequestedAt: '2026-01-01T00:00:00.000Z',
    }),
    false,
    'creator already requested — use accept-cancellation'
  )

  assert.equal(
    canAdminForceCancelMilestoneRaffle({
      ...base,
      cancellationFeePaidAt: '2026-01-01T00:00:00.000Z',
    }),
    false,
    'creator paid fee — use accept-cancellation'
  )

  assert.equal(
    canAdminForceCancelMilestoneRaffle({ ...base, status: 'cancelled', cancelledAt: '2026-01-02' }),
    false,
    'already cancelled'
  )

  assert.equal(
    canAdminForceCancelMilestoneRaffle({ ...base, winnerWallet: 'Winner111' }),
    false,
    'winner selected'
  )

  assert.equal(
    canAdminForceCancelMilestoneRaffle({ ...base, status: 'draft' }),
    false,
    'draft not force-cancellable via this path'
  )

  assert.equal(
    canAdminForceCancelMilestoneRaffle({ ...base, status: 'ready_to_draw' }),
    true,
    'ready_to_draw milestone raffle eligible'
  )

  assert.equal(
    canAdminForceCancelMilestoneRaffle({ ...base, status: 'pending_min_not_met' }),
    true,
    'pending_min_not_met (ended / min-not-met) eligible'
  )

  console.log('test-force-cancel-eligibility: ok')
}

main()
