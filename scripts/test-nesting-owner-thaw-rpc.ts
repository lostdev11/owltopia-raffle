/**
 * Unit tests for leftover Owner-thaw RPC error copy + prepare batch cap.
 * Run: npx tsx scripts/test-nesting-owner-thaw-rpc.ts
 */
import assert from 'node:assert/strict'
import { formatNestingWalletError } from '../lib/nesting/wallet-error'
import { MPL_CORE_OWNER_THAW_PREPARE_MAX } from '../lib/solana/mpl-core-owner-thaw-prepare'

assert.equal(MPL_CORE_OWNER_THAW_PREPARE_MAX, 1)

const rpcFail = new Error('Failed to fetch')
const nestCopy = formatNestingWalletError(rpcFail, 'Backpack', 'NFT', 'nest')
assert.match(nestCopy, /prepare the nest transaction/i)
assert.match(nestCopy, /Backpack/i)

const thawCopy = formatNestingWalletError(rpcFail, 'Backpack', 'NFT', 'thaw')
assert.match(thawCopy, /prepare the thaw transaction/i)
assert.match(thawCopy, /server RPC/i)
assert.doesNotMatch(thawCopy, /prepare the nest transaction/i)

const rate = formatNestingWalletError(
  Object.assign(new Error('429 Too Many Requests'), { code: 429 }),
  'Phantom',
  'NFT',
  'thaw'
)
assert.match(rate, /rate-limited/i)
assert.match(rate, /private RPC/i)

console.log('test-nesting-owner-thaw-rpc: ok')
