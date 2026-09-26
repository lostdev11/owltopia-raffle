import assert from 'node:assert/strict'
import {
  canMutatePackOpensAdmin,
  canReadAdminPackOpens,
  evaluateAdminPackOpensReadAccess,
  evaluatePackOpenResolveAccess,
} from '../lib/admin-pack-opens/access'
import { assertNoPackOpenSecrets, mapPackOpenToAdminListRow } from '../lib/admin-pack-opens/map-row'
import {
  buildPackOpensListFilterPlan,
  packOpensStuckCutoffIso,
  parseListAdminPackOpensQuery,
} from '../lib/admin-pack-opens/parse-query'
import { ADMIN_PACK_OPEN_STUCK_PIPELINE_STATUSES } from '../lib/admin-pack-opens/constants'
import type { PackOpenRow } from '../lib/packs/types'

// --- Access control (mirrors Ops Log read vs pack resolve mutations) ---

assert.equal(canReadAdminPackOpens(null), false)
assert.equal(canReadAdminPackOpens(undefined), false)
assert.equal(canReadAdminPackOpens('mod'), true)
assert.equal(canReadAdminPackOpens('full'), true)

assert.equal(canMutatePackOpensAdmin('mod'), false)
assert.equal(canMutatePackOpensAdmin('full'), true)

assert.deepEqual(evaluateAdminPackOpensReadAccess({ hasSession: false, role: 'mod' }), {
  allowed: false,
  status: 401,
  reason: 'no_session',
})

assert.deepEqual(evaluateAdminPackOpensReadAccess({ hasSession: true, role: null }), {
  allowed: false,
  status: 403,
  reason: 'not_admin',
})

assert.equal(evaluateAdminPackOpensReadAccess({ hasSession: true, role: 'mod' }).allowed, true)
assert.equal(evaluateAdminPackOpensReadAccess({ hasSession: true, role: 'full' }).allowed, true)

assert.deepEqual(evaluatePackOpenResolveAccess({ hasSession: true, role: 'mod' }), {
  allowed: false,
  status: 403,
  reason: 'not_admin',
})

assert.equal(evaluatePackOpenResolveAccess({ hasSession: true, role: 'full' }).allowed, true)

// --- Query parsing ---

const q1 = parseListAdminPackOpensQuery(
  new URLSearchParams(
    'wallet=ArcingMA84xzmA1BQbmhHhKdWRGDyRQSN8uccWkh2rD4&wallet_mode=prefix&status=failed,refund_needed&stuck=1&limit=25&offset=10'
  )
)
assert.equal(q1.walletMode, 'prefix')
assert.deepEqual(q1.statuses, ['failed', 'refund_needed'])
assert.equal(q1.stuckAttention, true)
assert.equal(q1.limit, 25)
assert.equal(q1.offset, 10)

const now = Date.UTC(2026, 8, 26, 12, 0, 0)
const plan = buildPackOpensListFilterPlan(
  { ...q1, wallet: 'Arc', walletMode: 'prefix', limit: 50, offset: 0 },
  now
)
assert.equal(plan.wallet?.mode, 'prefix')
assert.equal(plan.wallet?.value, 'Arc')
assert.ok(plan.stuckAttention)
assert.equal(
  plan.stuckAttention?.cutoffIso,
  packOpensStuckCutoffIso(now, 5)
)
assert.deepEqual(plan.stuckAttention?.pipelineStatuses, ADMIN_PACK_OPEN_STUCK_PIPELINE_STATUSES)

// --- Secret column whitelist ---

const sampleRow: PackOpenRow = {
  id: '00000000-0000-4000-8000-000000000001',
  product_id: '00000000-0000-4000-8000-000000000002',
  buyer_wallet: 'Buyer1111111111111111111111111111111111111',
  payment_signature: 'sig',
  payment_currency: 'SOL',
  payment_owl_amount: null,
  payment_fee_sol: null,
  status: 'completed',
  open_algo: 'owltopia-pack-open-v1',
  open_seed: 'SECRET_SEED_MUST_NOT_LEAK',
  open_commit_hash: 'abc',
  category: 'owl',
  prize_label: '100 OWL',
  owl_amount: 100,
  sol_amount: null,
  nft_inventory_id: null,
  nft_mint_address: null,
  fair_value_sol: null,
  free_ticket_credits: 0,
  payout_signature: 'payout',
  is_jackpot_win: false,
  jackpot_contribution_sol: null,
  jackpot_amount_sol: null,
  error_message: null,
  created_at: '2026-01-01T00:00:00.000Z',
  completed_at: '2026-01-01T00:01:00.000Z',
}

const mapped = mapPackOpenToAdminListRow({
  ...sampleRow,
  pack_products: { id: sampleRow.product_id, slug: 'owl-pack-v1', name: 'Owl Pack', price_sol: 0.1 },
})
assert.ok(!('open_seed' in mapped))
assert.equal(mapped.prize_summary?.includes('OWL'), true)

assert.throws(() => {
  assertNoPackOpenSecrets({ open_seed: 'nope' })
}, /open_seed/)

console.log('test-admin-pack-opens: ok')
