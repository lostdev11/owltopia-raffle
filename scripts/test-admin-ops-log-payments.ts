import assert from 'node:assert/strict'
import bs58 from 'bs58'
import {
  canDeleteAdminOpsLogEntry,
  canUseAdminOpsLog,
  evaluateAdminOpsLogAccess,
  evaluateAdminOpsLogDeleteAccess,
} from '../lib/admin-ops-log/access'
import { parseCreateAdminOpsLogPaymentBody, parseUpdateAdminOpsLogPaymentBody } from '../lib/admin-ops-log/parse-payment-body'
import {
  formatPaymentTotalsByAsset,
  sumPaymentsByAsset,
  totalsForOpsLogEntry,
} from '../lib/admin-ops-log/totals'
import { validateOptionalSolanaTxSignature } from '../lib/admin-ops-log/validate-tx-signature'

// --- Access (mirrors ops-log routes: mod+full mutate, full-only delete entry) ---

assert.equal(canUseAdminOpsLog(null), false)
assert.equal(canUseAdminOpsLog('mod'), true)
assert.equal(canUseAdminOpsLog('full'), true)
assert.equal(canDeleteAdminOpsLogEntry('mod'), false)
assert.equal(canDeleteAdminOpsLogEntry('full'), true)

assert.deepEqual(evaluateAdminOpsLogAccess({ hasSession: false, role: 'mod' }), {
  allowed: false,
  status: 401,
  reason: 'no_session',
})

assert.equal(evaluateAdminOpsLogAccess({ hasSession: true, role: 'mod' }).allowed, true)
assert.equal(evaluateAdminOpsLogAccess({ hasSession: true, role: null }).allowed, false)

assert.equal(evaluateAdminOpsLogDeleteAccess({ hasSession: true, role: 'mod' }).allowed, false)
assert.equal(evaluateAdminOpsLogDeleteAccess({ hasSession: true, role: 'full' }).allowed, true)

// --- Totals ---

const multi = sumPaymentsByAsset([
  { amount: 80, asset: 'OWL' },
  { amount: 0.033, asset: 'SOL' },
  { amount: 20, asset: 'OWL' },
])
assert.equal(multi.OWL, 100)
assert.equal(multi.SOL, 0.033)
assert.equal(formatPaymentTotalsByAsset(multi), '100 OWL + 0.033 SOL')

const legacyOnly = totalsForOpsLogEntry([], { amount: 5, asset: 'SOL' })
assert.deepEqual(legacyOnly, { SOL: 5 })

const paymentsWin = totalsForOpsLogEntry(
  [{ amount: 1, asset: 'OWL' }],
  { amount: 99, asset: 'SOL' }
)
assert.deepEqual(paymentsWin, { OWL: 1 })

// --- Tx signature validation ---

const badLen = validateOptionalSolanaTxSignature('abc')
assert.equal(badLen.ok, false)

const emptyOk = validateOptionalSolanaTxSignature('')
assert.equal(emptyOk.ok, true)
if (emptyOk.ok) assert.equal(emptyOk.normalized, null)

// --- Payment body parsing ---

const sig = bs58.encode(Buffer.alloc(64, 7))
const created = parseCreateAdminOpsLogPaymentBody(
  {
    amount: 80,
    asset: 'OWL',
    to_wallet: 'Buyer1111111111111111111111111111111111111',
    tx_signature: sig,
    related_pack_open_id: '00000000-0000-4000-8000-000000000001',
  },
  '00000000-0000-4000-8000-000000000002',
  'ArcingMA84xzmA1BQbmhHhKdWRGDyRQSN8uccWkh2rD4'
)
assert.equal(created.ok, true)
if (created.ok) {
  assert.equal(created.params.amount, 80)
  assert.equal(created.params.asset, 'OWL')
  assert.equal(created.params.txSignature, sig)
}

const badTx = parseCreateAdminOpsLogPaymentBody({ tx_signature: 'not-a-sig' }, 'e1', 'w1')
assert.equal(badTx.ok, false)

const patched = parseUpdateAdminOpsLogPaymentBody({ amount: 10, asset: 'SOL', note: 'second leg' })
assert.equal(patched.ok, true)
if (patched.ok) {
  assert.equal(patched.params.amount, 10)
  assert.equal(patched.params.note, 'second leg')
}

console.log('test-admin-ops-log-payments: ok')
