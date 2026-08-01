/**
 * Unit tests for OwlSend batching / scatter pairing / fee math.
 * Run: npx tsx scripts/test-owl-send-batch.ts
 */
import assert from 'node:assert/strict'
import {
  capOwlSendSelection,
  chunkOwlSendBatches,
  pairScatterLines,
  parseRecipientAddresses,
} from '@/lib/owl-send/batch'
import { OWL_SEND_MAX_PER_TX, OWL_SEND_MAX_SELECT } from '@/lib/owl-send/constants'
import { buildOwlSendCostEstimate } from '@/lib/owl-send/cost-estimate'
import { getOwlSendFeeLamportsForCount, getOwlSendFeeSol } from '@/lib/owl-send/fee'
import { canAccessOwlSend } from '@/lib/owl-send/access'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

assert.equal(OWL_SEND_MAX_PER_TX, 5)
assert.equal(OWL_SEND_MAX_SELECT, 20)
assert.equal(getOwlSendFeeSol(), 0.001)
assert.equal(getOwlSendFeeLamportsForCount(5), Math.round(0.001 * LAMPORTS_PER_SOL) * 5)

const capped = capOwlSendSelection(Array.from({ length: 25 }, (_, i) => i))
assert.equal(capped.length, 20)

const batches = chunkOwlSendBatches(Array.from({ length: 20 }, (_, i) => i))
assert.equal(batches.length, 4)
assert.equal(batches[0]!.length, 5)
assert.equal(batches[3]!.length, 5)

const addrs = parseRecipientAddresses('Aaa\nBbb, Ccc;Ddd')
assert.deepEqual(addrs, ['Aaa', 'Bbb', 'Ccc', 'Ddd'])

const badPair = pairScatterLines({
  mints: [{ mint: 'm1' }, { mint: 'm2' }],
  recipients: ['r1'],
  randomize: false,
})
assert.equal(badPair.ok, false)

const goodPair = pairScatterLines({
  mints: [
    { mint: 'm1', name: 'A' },
    { mint: 'm2', name: 'B' },
  ],
  recipients: ['r1', 'r2'],
  randomize: false,
})
assert.equal(goodPair.ok, true)
if (goodPair.ok) {
  assert.equal(goodPair.lines.length, 2)
  assert.equal(goodPair.lines[0]!.recipient, 'r1')
  assert.equal(goodPair.lines[1]!.recipient, 'r2')
}

const cost = buildOwlSendCostEstimate({ nftCount: 20, batchCount: 4, newAtaCount: 2 })
assert.ok(cost)
assert.equal(cost!.platformFeeSol, 0.02)
assert.ok(cost!.rentSolKnown != null && cost!.rentSolKnown > 0)

assert.equal(canAccessOwlSend({ isAdmin: true, publicOverride: false }), true)
assert.equal(canAccessOwlSend({ isAdmin: false, publicOverride: false }), false)
assert.equal(canAccessOwlSend({ isAdmin: false, publicOverride: true }), true)

console.log('test-owl-send-batch: ok')
