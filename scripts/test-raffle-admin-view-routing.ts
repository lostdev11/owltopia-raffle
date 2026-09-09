/**
 * Admin raffle page routing — milestone raffles must not land on EditRaffleForm alone.
 *
 * Run: npx --yes tsx scripts/test-raffle-admin-view-routing.ts
 */
import assert from 'node:assert/strict'

import { shouldUseEditRaffleFormAdminView } from '../lib/admin/raffle-admin-view'

function main() {
  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'draft',
      hasConfirmedEntries: false,
      milestoneCount: 0,
      endTimePassed: false,
    }),
    true,
    'plain draft uses edit form'
  )

  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'draft',
      hasConfirmedEntries: false,
      milestoneCount: 2,
    }),
    false,
    'draft milestone raffle uses admin actions for escrow settle'
  )

  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'draft',
      hasConfirmedEntries: false,
      milestoneCount: 0,
      endTimePassed: true,
    }),
    false,
    'draft past end_time uses admin actions (shows Ended on cards)'
  )

  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'live',
      hasConfirmedEntries: false,
      milestoneCount: 0,
    }),
    true,
    'live without tickets or milestones uses edit form'
  )

  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'live',
      hasConfirmedEntries: false,
      milestoneCount: 1,
    }),
    false,
    'live milestone raffle (Captain Solana case) uses admin actions'
  )

  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'live',
      hasConfirmedEntries: true,
      milestoneCount: 1,
    }),
    false,
    'live with tickets uses admin actions'
  )

  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'cancelled',
      hasConfirmedEntries: false,
      milestoneCount: 1,
    }),
    false,
    'cancelled milestone raffle uses admin actions for deposit return'
  )

  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'pending_min_not_met',
      hasConfirmedEntries: false,
      milestoneCount: 1,
    }),
    false,
    'ended min-not-met milestone raffle uses admin actions'
  )

  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'live',
      hasConfirmedEntries: false,
      milestoneCount: 0,
      endTimePassed: true,
    }),
    false,
    'ended live raffle (no tickets) uses admin actions not edit form'
  )

  assert.equal(
    shouldUseEditRaffleFormAdminView({
      status: 'live',
      hasConfirmedEntries: false,
      milestoneCount: 0,
      endTimePassed: false,
    }),
    true,
    'live upcoming raffle with no tickets still uses edit form'
  )

  console.log('test-raffle-admin-view-routing: ok')
}

main()
