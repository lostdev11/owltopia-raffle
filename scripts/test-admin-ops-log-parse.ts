import assert from 'node:assert/strict'
import { parseCreateAdminOpsLogBody, parseUpdateAdminOpsLogBody } from '../lib/admin-ops-log/parse-body'

const wallet = 'TestWallet11111111111111111111111111111111'

const created = parseCreateAdminOpsLogBody(
  {
    type: 'refund',
    title: 'Manual SOL refund',
    amount: 1.5,
    asset: 'SOL',
    status: 'done',
  },
  wallet
)
assert.equal(created.ok, true)
if (created.ok) {
  assert.equal(created.params.type, 'refund')
  assert.equal(created.params.title, 'Manual SOL refund')
  assert.equal(created.params.amount, 1.5)
}

const bad = parseCreateAdminOpsLogBody({ type: 'nope', title: 'x' }, wallet)
assert.equal(bad.ok, false)

const patched = parseUpdateAdminOpsLogBody({ status: 'needs_decision' }, wallet)
assert.equal(patched.ok, true)

console.log('test-admin-ops-log-parse: ok')
