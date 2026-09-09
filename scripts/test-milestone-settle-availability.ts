/**
 * Admin milestone escrow settle availability (force-cancel vs return deposits).
 *
 * Run: npx --yes tsx scripts/test-milestone-settle-availability.ts
 */
import assert from 'node:assert/strict'

import { getAdminMilestoneSettleAvailability } from '../lib/raffles/milestone-settle-availability'

const fundedCryptoMilestone = {
  status: 'pending' as const,
  deposit_verified_at: '2026-01-01T00:00:00.000Z',
  returned_at: null,
  return_tx: null,
  prize_type: 'crypto' as const,
}

function main() {
  assert.deepEqual(
    getAdminMilestoneSettleAvailability({
      status: 'live',
      milestones: [fundedCryptoMilestone],
      cancellationRequestedAt: null,
      cancellationFeePaidAt: null,
      cancelledAt: null,
      winnerWallet: null,
      winnerSelectedAt: null,
    }),
    { mode: 'force_cancel', returnableMilestoneCount: 0 },
    'live milestone raffle → force cancel'
  )

  assert.deepEqual(
    getAdminMilestoneSettleAvailability({
      status: 'draft',
      milestones: [fundedCryptoMilestone],
      cancellationRequestedAt: null,
      cancellationFeePaidAt: null,
      cancelledAt: null,
      winnerWallet: null,
      winnerSelectedAt: null,
    }),
    { mode: 'force_cancel', returnableMilestoneCount: 0 },
    'draft milestone raffle → abandon draft / force cancel'
  )

  assert.deepEqual(
    getAdminMilestoneSettleAvailability({
      status: 'pending_min_not_met',
      milestones: [fundedCryptoMilestone],
      cancellationRequestedAt: null,
      cancellationFeePaidAt: null,
      cancelledAt: null,
      winnerWallet: null,
      winnerSelectedAt: null,
    }),
    { mode: 'force_cancel', returnableMilestoneCount: 0 },
    'ended / min-not-met → force cancel'
  )

  assert.equal(
    getAdminMilestoneSettleAvailability({
      status: 'cancelled',
      milestones: [{ ...fundedCryptoMilestone, status: 'void' }],
      cancellationRequestedAt: null,
      cancellationFeePaidAt: null,
      cancelledAt: '2026-01-02',
      winnerWallet: null,
      winnerSelectedAt: null,
    }).mode,
    'return_deposits',
    'cancelled with void funded milestone → return deposits'
  )

  assert.equal(
    getAdminMilestoneSettleAvailability({
      status: 'live',
      milestones: [],
      cancellationRequestedAt: null,
      cancellationFeePaidAt: null,
      cancelledAt: null,
      winnerWallet: null,
      winnerSelectedAt: null,
    }).mode,
    'unavailable',
    'no milestones'
  )

  assert.match(
    getAdminMilestoneSettleAvailability({
      status: 'live',
      milestones: [fundedCryptoMilestone],
      cancellationRequestedAt: '2026-01-01',
      cancellationFeePaidAt: null,
      cancelledAt: null,
      winnerWallet: null,
      winnerSelectedAt: null,
    }).reason ?? '',
    /Accept cancellation/,
    'creator requested cancel → use accept flow'
  )

  console.log('test-milestone-settle-availability: ok')
}

main()
