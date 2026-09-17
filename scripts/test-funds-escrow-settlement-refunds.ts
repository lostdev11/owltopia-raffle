/**
 * Settlement gross must exclude refunded confirmed entries (funds already left escrow).
 * Run: npx tsx scripts/test-funds-escrow-settlement-refunds.ts
 */
import assert from 'node:assert/strict'
import { getRaffleRevenue } from '../lib/raffle-profit'
import { calculateSettlement } from '../lib/raffles/calculate-settlement'
import type { Entry } from '../lib/types'

function entry(partial: Partial<Entry> & Pick<Entry, 'id' | 'amount_paid' | 'currency' | 'status'>): Entry {
  return {
    raffle_id: 'r1',
    wallet_address: 'Wallet111111111111111111111111111111111',
    ticket_quantity: 1,
    transaction_signature: null,
    created_at: new Date().toISOString(),
    verified_at: null,
    restored_at: null,
    restored_by: null,
    refunded_at: null,
    refund_transaction_signature: null,
    ...partial,
  } as Entry
}

const live = entry({
  id: 'e1',
  status: 'confirmed',
  amount_paid: 0.4,
  currency: 'SOL',
  refunded_at: null,
})
const refunded = entry({
  id: 'e2',
  status: 'confirmed',
  amount_paid: 0.1,
  currency: 'SOL',
  refunded_at: new Date().toISOString(),
})

const revenue = getRaffleRevenue([live, refunded])
assert.equal(revenue.sol, 0.4, 'refunded confirmed entry must not inflate SOL revenue')

const { platformFee, creatorPayout } = calculateSettlement(revenue.sol, 600)
assert.ok(Math.abs(creatorPayout + platformFee - 0.4) < 1e-9, 'settlement legs sum to unrefunded gross')
assert.ok(creatorPayout + platformFee < 0.5, 'must not settle the refunded 0.1 SOL')

console.log('ok: getRaffleRevenue excludes refunded confirmed entries for settlement')
