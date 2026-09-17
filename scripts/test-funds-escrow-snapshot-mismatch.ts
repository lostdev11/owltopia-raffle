/**
 * Snapshot vs live funds-escrow pubkey mismatch detection.
 * Run: npx tsx scripts/test-funds-escrow-snapshot-mismatch.ts
 */
import assert from 'node:assert/strict'
import { fundsEscrowSnapshotMismatchError } from '../lib/raffles/funds-escrow'

const live = 'LiveEscrow111111111111111111111111111111111'
const snap = 'OldEscrow2222222222222222222222222222222222'

assert.equal(fundsEscrowSnapshotMismatchError(null, live), null)
assert.equal(fundsEscrowSnapshotMismatchError('', live), null)
assert.equal(fundsEscrowSnapshotMismatchError(live, live), null)
assert.equal(fundsEscrowSnapshotMismatchError(`  ${live}  `, live), null)

const err = fundsEscrowSnapshotMismatchError(snap, live)
assert.ok(err && /key mismatch/i.test(err), 'mismatch must return explicit error')
assert.ok(err!.includes(snap) && err!.includes(live), 'error must name both addresses')
assert.ok(!/short of SOL/i.test(err!), 'must not look like a generic shortfall')

console.log('ok: fundsEscrowSnapshotMismatchError distinguishes key rotation from shortfall')
