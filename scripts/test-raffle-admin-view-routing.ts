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
      milestoneCount: 2,
    }),
    true,
    'draft always uses edit form'
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

  console.log('test-raffle-admin-view-routing: ok')
}

main()
