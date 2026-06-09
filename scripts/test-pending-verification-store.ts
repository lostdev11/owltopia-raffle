/**
 * Mobile edge case: the tab dies between wallet send and verify (Phantom/Solflare
 * redirect, Android backgrounding). The pending-verification store must survive a
 * reload (serialize → parse), dedupe by signature, and stop retrying signatures
 * that are too old or definitively rejected.
 * Run: npx tsx scripts/test-pending-verification-store.ts
 */
import assert from 'node:assert/strict'
import {
  parsePendingVerifications,
  upsertPendingVerification,
  removePendingVerification,
  markPendingVerificationFailure,
  prunePendingVerifications,
  PENDING_VERIFICATION_MAX_AGE_MS,
  PENDING_VERIFICATION_MAX_FAILURES,
  type PendingVerificationRecord,
} from '../lib/client/pending-verification'

const SIG_A = 'A'.repeat(88)
const SIG_B = 'B'.repeat(88)

const now = Date.now()

const single: PendingVerificationRecord = {
  kind: 'single',
  entryIds: ['entry-1'],
  transactionSignature: SIG_A,
  walletAddress: 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  createdAt: now,
  failCount: 0,
}

const batch: PendingVerificationRecord = {
  kind: 'batch',
  entryIds: ['entry-2', 'entry-3'],
  transactionSignature: SIG_B,
  walletAddress: 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  createdAt: now,
  failCount: 0,
}

// --- Survives a tab kill + reload (serialize → parse round-trip) ---
let records = upsertPendingVerification([], single)
records = upsertPendingVerification(records, batch)
const reloaded = parsePendingVerifications(JSON.stringify(records))
assert.equal(reloaded.length, 2)
assert.deepEqual(reloaded.find(r => r.transactionSignature === SIG_B)?.entryIds, ['entry-2', 'entry-3'])
assert.equal(reloaded.find(r => r.transactionSignature === SIG_A)?.kind, 'single')

// --- One record per payment signature (double-tap / re-entry dedupes) ---
const deduped = upsertPendingVerification(reloaded, { ...single, entryIds: ['entry-1-retry'] })
assert.equal(deduped.length, 2)
assert.deepEqual(deduped.find(r => r.transactionSignature === SIG_A)?.entryIds, ['entry-1-retry'])

// --- Verify success clears only that signature ---
const afterConfirm = removePendingVerification(deduped, SIG_A)
assert.equal(afterConfirm.length, 1)
assert.equal(afterConfirm[0]?.transactionSignature, SIG_B)

// --- Definitive 4xx rejections accumulate; record dropped at the cap ---
let failing = [batch]
for (let i = 0; i < PENDING_VERIFICATION_MAX_FAILURES; i++) {
  assert.equal(prunePendingVerifications(failing, now).length, 1, `kept before cap (fail ${i})`)
  failing = markPendingVerificationFailure(failing, SIG_B)
}
assert.equal(failing[0]?.failCount, PENDING_VERIFICATION_MAX_FAILURES)
assert.equal(prunePendingVerifications(failing, now).length, 0, 'dropped at failure cap')

// --- Stale records expire (raffle long over; admin tools take over) ---
const stale = { ...single, createdAt: now - PENDING_VERIFICATION_MAX_AGE_MS - 1 }
assert.equal(prunePendingVerifications([stale], now).length, 0)
assert.equal(
  prunePendingVerifications([{ ...single, createdAt: now - PENDING_VERIFICATION_MAX_AGE_MS + 60_000 }], now).length,
  1
)

// --- Corrupt / hostile storage degrades to empty, never throws ---
assert.deepEqual(parsePendingVerifications(null), [])
assert.deepEqual(parsePendingVerifications('not json'), [])
assert.deepEqual(parsePendingVerifications('{"lines":[]}'), [])
assert.deepEqual(
  parsePendingVerifications(JSON.stringify([{ kind: 'single', transactionSignature: 'too-short', entryIds: ['x'], walletAddress: 'w' }])),
  []
)
assert.deepEqual(
  parsePendingVerifications(JSON.stringify([{ kind: 'batch', transactionSignature: SIG_A, entryIds: [], walletAddress: 'w' }])),
  []
)

// Records missing optional numerics get safe defaults
const defaulted = parsePendingVerifications(
  JSON.stringify([{ kind: 'single', transactionSignature: SIG_A, entryIds: ['e'], walletAddress: 'w'.repeat(32) }])
)
assert.equal(defaulted.length, 1)
assert.equal(defaulted[0]?.failCount, 0)
assert.ok(Number.isFinite(defaulted[0]?.createdAt))

console.log('pending-verification-store: ok')
