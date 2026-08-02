/**
 * Unit tests for OwlSend batching / scatter pairing / fee math.
 * Run: npx tsx scripts/test-owl-send-batch.ts
 */
import assert from 'node:assert/strict'
import {
  buildTokenScatterLines,
  capOwlSendSelection,
  chunkOwlSendBatches,
  pairScatterLines,
  parseRecipientAddresses,
  parseTokenScatterEntries,
} from '@/lib/owl-send/batch'
import { owlSendNftLockLabel } from '@/lib/owl-send/picker-eligibility'
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

// Randomize: 20 NFTs across 4 wallets (~5 each)
const distribute = pairScatterLines({
  mints: Array.from({ length: 20 }, (_, i) => ({ mint: `m${i}` })),
  recipients: ['w1', 'w2', 'w3', 'w4'],
  randomize: true,
})
assert.equal(distribute.ok, true)
if (distribute.ok) {
  assert.equal(distribute.lines.length, 20)
  const counts = new Map<string, number>()
  for (const line of distribute.lines) {
    counts.set(line.recipient, (counts.get(line.recipient) ?? 0) + 1)
  }
  assert.equal(counts.size, 4)
  for (const c of counts.values()) assert.equal(c, 5)
}

// Randomize with duplicate paste still uses unique wallets
const deduped = pairScatterLines({
  mints: Array.from({ length: 6 }, (_, i) => ({ mint: `d${i}` })),
  recipients: ['a', 'b', 'a'],
  randomize: true,
})
assert.equal(deduped.ok, true)
if (deduped.ok) {
  const set = new Set(deduped.lines.map((l) => l.recipient))
  assert.equal(set.size, 2)
  assert.equal(deduped.lines.filter((l) => l.recipient === 'a').length, 3)
  assert.equal(deduped.lines.filter((l) => l.recipient === 'b').length, 3)
}

const cost = buildOwlSendCostEstimate({ nftCount: 20, batchCount: 4, newAtaCount: 2 })
assert.ok(cost)
assert.equal(cost!.platformFeeSol, 0.02)
assert.ok(cost!.rentSolKnown != null && cost!.rentSolKnown > 0)

assert.equal(canAccessOwlSend({ isAdmin: true, publicOverride: false }), true)
assert.equal(canAccessOwlSend({ isAdmin: false, publicOverride: false }), false)
assert.equal(canAccessOwlSend({ isAdmin: false, publicOverride: true }), true)

const scatterEntries = parseTokenScatterEntries('Aaa\nBbb,10\nCcc 2.5')
assert.equal(scatterEntries.length, 3)
assert.equal(scatterEntries[0]!.recipient, 'Aaa')
assert.equal(scatterEntries[0]!.amountUi, null)
assert.equal(scatterEntries[1]!.recipient, 'Bbb')
assert.equal(scatterEntries[1]!.amountUi, '10')
assert.equal(scatterEntries[2]!.recipient, 'Ccc')
assert.equal(scatterEntries[2]!.amountUi, '2.5')

const tokenLines = buildTokenScatterLines({
  mint: 'mint1',
  tokenAccount: 'ata1',
  decimals: 0,
  symbol: 'OWL',
  defaultAmountUi: '1',
  entries: [
    { recipient: 'r1', amountUi: null },
    { recipient: 'r2', amountUi: '3' },
  ],
})
assert.equal(tokenLines.ok, true)
if (tokenLines.ok) {
  assert.equal(tokenLines.lines.length, 2)
  assert.equal(tokenLines.lines[0]!.amountRaw, 1n)
  assert.equal(tokenLines.lines[1]!.amountRaw, 3n)
  assert.equal(tokenLines.lines[1]!.recipient, 'r2')
  const tokenChunks = chunkOwlSendBatches(tokenLines.lines)
  assert.equal(tokenChunks.length, 1)
}

const tooMany = buildTokenScatterLines({
  mint: 'mint1',
  tokenAccount: 'ata1',
  decimals: 0,
  defaultAmountUi: '1',
  entries: Array.from({ length: 21 }, (_, i) => ({ recipient: `r${i}`, amountUi: null })),
})
assert.equal(tooMany.ok, false)

// Picker shows all NFTs; lock label is advisory only
assert.equal(
  owlSendNftLockLabel({
    mint: 'm',
    tokenAccount: 't',
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: null,
    image: null,
    collectionName: null,
    frozen: true,
    delegated: false,
  }),
  'Frozen'
)
assert.equal(
  owlSendNftLockLabel({
    mint: 'm',
    tokenAccount: 't',
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: null,
    image: null,
    collectionName: null,
    frozen: true,
    delegated: true,
  }),
  'Staked/nested'
)
assert.equal(
  owlSendNftLockLabel({
    mint: 'm',
    tokenAccount: 't',
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: null,
    image: null,
    collectionName: null,
  }),
  null
)

console.log('test-owl-send-batch: ok')
