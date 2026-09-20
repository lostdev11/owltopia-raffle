/**
 * Orphan pool-payout coverage adjustment.
 * Run: npx tsx scripts/test-gen-owl-rev-share-orphan-payouts.ts
 */
import assert from 'node:assert/strict'
import {
  applyOrphanRevSharePoolPayoutsToRequired,
  orphanRevSharePoolPayouts,
} from '../lib/nesting/gen-owl-rev-share-orphan-payouts'

const orphan = orphanRevSharePoolPayouts({
  ledger_sol: 1.092053159,
  ledger_usdc: 0,
  claims_committed_sol: 1.0,
  claims_committed_usdc: 0,
})
assert.ok(Math.abs(orphan.orphan_sol - 0.092053159) < 1e-9)

const required = applyOrphanRevSharePoolPayoutsToRequired({
  required_sol: 3.20333,
  required_usdc: 0,
  orphan_sol: orphan.orphan_sol,
  orphan_usdc: 0,
})
assert.ok(Math.abs(required.required_sol - (3.20333 - 0.092053159)) < 1e-9)

const none = orphanRevSharePoolPayouts({
  ledger_sol: 1,
  ledger_usdc: 0,
  claims_committed_sol: 1,
  claims_committed_usdc: 0,
})
assert.equal(none.orphan_sol, 0)

console.log('test-gen-owl-rev-share-orphan-payouts: ok')
