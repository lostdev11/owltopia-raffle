/**
 * Creator Enable trading soft-gate: sell-out required; planned date does not unlock.
 */
import assert from 'node:assert/strict'
import { isCreatorCoreThawAllowed } from '../lib/owl-center/creator-core-thaw-gate'

assert.equal(
  isCreatorCoreThawAllowed({
    active_phase: 'PUBLIC',
    minted_count: 50,
    total_supply: 100,
    freeze_status: 'frozen',
  }).ok,
  false,
  'mid-mint blocked'
)

assert.equal(
  isCreatorCoreThawAllowed({
    active_phase: 'PUBLIC',
    minted_count: 100,
    total_supply: 100,
    freeze_status: 'frozen',
  }).ok,
  true,
  'sell-out allows'
)

assert.equal(
  isCreatorCoreThawAllowed({
    active_phase: 'SOLD_OUT',
    minted_count: 10,
    total_supply: 100,
    freeze_status: 'frozen',
  }).ok,
  true,
  'SOLD_OUT phase allows'
)

const already = isCreatorCoreThawAllowed({
  active_phase: 'TRADING_ACTIVE',
  freeze_status: 'thawed',
})
assert.equal(already.ok, false)
if (!already.ok) assert.match(already.error, /already enabled/i)

console.log('test-creator-core-thaw-gate: ok')
