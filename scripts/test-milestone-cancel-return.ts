/**
 * Regression checks: cancelled / failed-refund raffles with milestones get the same
 * deposit return path as min-threshold terminal failure (void + return eligibility).
 *
 * Run: npx --yes tsx scripts/test-milestone-cancel-return.ts
 */
import assert from 'node:assert/strict'

import type { RaffleMilestone } from '../lib/types'
import {
  isMilestoneDepositReturnable,
  isTerminalRaffleForMilestoneReturn,
} from '../lib/raffles/milestones/return-eligibility'

function milestone(
  over: Partial<RaffleMilestone> & Pick<RaffleMilestone, 'status'>
): RaffleMilestone {
  return {
    id: 'm1',
    raffle_id: 'r1',
    sort_order: 0,
    trigger_type: 'absolute_tickets',
    trigger_value: 50,
    prize_type: 'crypto',
    prize_amount: 1,
    prize_currency: 'SOL',
    nft_mint_address: null,
    nft_token_id: null,
    winner_mode: 'random',
    unlocked_at: null,
    winner_wallet: null,
    winner_selected_at: null,
    winner_selection_mode: null,
    deposit_tx: 'tx1',
    deposit_verified_at: '2026-01-01T00:00:00.000Z',
    claim_tx: null,
    claimed_at: null,
    returned_at: null,
    return_tx: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function main() {
  assert.equal(isTerminalRaffleForMilestoneReturn('cancelled'), true)
  assert.equal(isTerminalRaffleForMilestoneReturn('failed_refund_available'), true)
  assert.equal(isTerminalRaffleForMilestoneReturn('live'), false)

  // Blocked before cancel: milestone raffles had no return path while still live.
  assert.equal(
    isMilestoneDepositReturnable({ milestone: milestone({ status: 'pending' }), raffleStatus: 'live' }),
    false
  )

  // Non-milestone parity baseline: cancelled + funded crypto milestone is returnable.
  assert.equal(
    isMilestoneDepositReturnable({ milestone: milestone({ status: 'pending' }), raffleStatus: 'cancelled' }),
    true
  )
  assert.equal(
    isMilestoneDepositReturnable({ milestone: milestone({ status: 'unlocked' }), raffleStatus: 'cancelled' }),
    true
  )
  assert.equal(
    isMilestoneDepositReturnable({ milestone: milestone({ status: 'void' }), raffleStatus: 'cancelled' }),
    true
  )

  // After min-threshold terminal failure, milestones are voided — same return eligibility.
  assert.equal(
    isMilestoneDepositReturnable({
      milestone: milestone({ status: 'void' }),
      raffleStatus: 'failed_refund_available',
    }),
    true
  )

  // Gap we fixed: accept-cancellation did not void milestones, but pending/unlocked were
  // still returnable server-side while UI only showed void — eligibility now matches API.
  assert.equal(
    isMilestoneDepositReturnable({
      milestone: milestone({ status: 'pending' }),
      raffleStatus: 'cancelled',
    }),
    true
  )

  // Already returned or awarded bonuses stay blocked.
  assert.equal(
    isMilestoneDepositReturnable({
      milestone: milestone({ status: 'returned', returned_at: '2026-01-02T00:00:00.000Z', return_tx: 'sig' }),
      raffleStatus: 'cancelled',
    }),
    false
  )
  assert.equal(
    isMilestoneDepositReturnable({
      milestone: milestone({ status: 'awarded', winner_wallet: 'Winner111' }),
      raffleStatus: 'cancelled',
    }),
    false
  )
  assert.equal(
    isMilestoneDepositReturnable({
      milestone: milestone({ status: 'pending', deposit_verified_at: null }),
      raffleStatus: 'cancelled',
    }),
    false
  )

  console.log('test-milestone-cancel-return: ok')
}

main()
