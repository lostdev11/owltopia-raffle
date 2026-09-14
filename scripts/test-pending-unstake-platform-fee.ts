/**
 * Unit tests for pending unstake / early-unstake platform-fee reuse helpers.
 * Run: npx tsx scripts/test-pending-unstake-platform-fee.ts
 */
import assert from 'node:assert/strict'
import {
  clearPendingUnstakePlatformFee,
  isPendingUnstakePlatformFeeFresh,
  parsePendingUnstakePlatformFee,
  pendingUnstakePlatformFeeMatches,
  PENDING_UNSTAKE_FEE_TTL_MS,
  readPendingUnstakePlatformFee,
  unstakeRetryWithoutRepayMessage,
  writePendingUnstakePlatformFee,
} from '../lib/nesting/pending-unstake-platform-fee'

const now = 1_700_000_000_000

assert.equal(parsePendingUnstakePlatformFee(null), null)
assert.equal(
  parsePendingUnstakePlatformFee({
    wallet: 'w',
    signature: 's',
    positionId: 'p',
    action: 'claim',
    units: 1,
  }),
  null
)

const parsed = parsePendingUnstakePlatformFee({
  wallet: ' Wallet1 ',
  signature: ' Sig1 ',
  positionId: ' Pos1 ',
  action: 'early_unstake',
  units: 1.9,
  savedAtMs: now,
})
assert.ok(parsed)
assert.equal(parsed!.wallet, 'Wallet1')
assert.equal(parsed!.signature, 'Sig1')
assert.equal(parsed!.positionId, 'Pos1')
assert.equal(parsed!.action, 'early_unstake')
assert.equal(parsed!.units, 1)
assert.equal(parsed!.savedAtMs, now)

assert.equal(isPendingUnstakePlatformFeeFresh(parsed!, now + PENDING_UNSTAKE_FEE_TTL_MS - 1), true)
assert.equal(isPendingUnstakePlatformFeeFresh(parsed!, now + PENDING_UNSTAKE_FEE_TTL_MS + 1), false)

assert.equal(
  pendingUnstakePlatformFeeMatches({
    fee: parsed!,
    wallet: 'Wallet1',
    positionId: 'Pos1',
    action: 'early_unstake',
    nowMs: now,
  }),
  true
)
assert.equal(
  pendingUnstakePlatformFeeMatches({
    fee: parsed!,
    wallet: 'Wallet1',
    positionId: 'Pos1',
    action: 'unstake',
    nowMs: now,
  }),
  false
)
assert.equal(
  pendingUnstakePlatformFeeMatches({
    fee: parsed!,
    wallet: 'Wallet1',
    positionId: 'Other',
    action: 'early_unstake',
    nowMs: now,
  }),
  false
)

assert.match(unstakeRetryWithoutRepayMessage(true), /early-leave fee was paid/i)
assert.match(unstakeRetryWithoutRepayMessage(false), /leave-nest fee was paid/i)

const mem = new Map<string, string>()
const fakeStorage = {
  getItem(key: string) {
    return mem.has(key) ? mem.get(key)! : null
  },
  setItem(key: string, value: string) {
    mem.set(key, value)
  },
  removeItem(key: string) {
    mem.delete(key)
  },
}

writePendingUnstakePlatformFee(
  {
    wallet: 'W1',
    signature: 'SigUnstake',
    positionId: 'nest-1',
    action: 'unstake',
    units: 1,
    savedAtMs: now,
  },
  fakeStorage
)
const loaded = readPendingUnstakePlatformFee(fakeStorage)
assert.ok(loaded)
assert.equal(loaded!.signature, 'SigUnstake')
assert.equal(loaded!.action, 'unstake')
assert.equal(
  pendingUnstakePlatformFeeMatches({
    fee: loaded!,
    wallet: 'W1',
    positionId: 'nest-1',
    action: 'unstake',
    nowMs: now,
  }),
  true
)
clearPendingUnstakePlatformFee(fakeStorage)
assert.equal(readPendingUnstakePlatformFee(fakeStorage), null)

console.log('pending-unstake-platform-fee: ok')
