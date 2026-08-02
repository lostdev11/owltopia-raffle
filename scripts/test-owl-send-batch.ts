/**
 * Unit tests for OwlSend batching / scatter pairing / fee math.
 * Run: npx tsx scripts/test-owl-send-batch.ts
 */
import assert from 'node:assert/strict'
import {
  buildTokenScatterLines,
  capOwlSendSelection,
  chunkOwlSendBatches,
  collapseRecipientsToNftScatterPaste,
  expandNftScatterEntries,
  pairScatterLines,
  parseNftScatterEntries,
  parseRecipientAddresses,
  parseTokenScatterEntries,
} from '@/lib/owl-send/batch'
import {
  buildResumeRemainingPlan,
  collectSentMintsFromBatches,
  collectSentMintsFromLedger,
} from '@/lib/owl-send/resume'
import { Keypair } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { mergeDasNftsWithOnChainLocks } from '@/lib/owl-send/merge-onchain-nft-locks'
import { owlSendNftLockLabel } from '@/lib/owl-send/picker-eligibility'
import { owlSendTokenAccountHint } from '@/lib/owl-send/resolve-spl-holder'
import { owlSendRetryHint } from '@/lib/owl-send/retry-hint'
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

// NFT wallet,count allotments (5 + 1 + 4 = 10)
const nftCountEntries = parseNftScatterEntries('wA,5\nwB,1\nwC,4')
assert.equal(nftCountEntries.length, 3)
assert.equal(nftCountEntries[0]!.count, 5)
assert.equal(nftCountEntries[1]!.count, 1)
assert.equal(nftCountEntries[2]!.count, 4)
assert.deepEqual(expandNftScatterEntries(nftCountEntries), [
  'wA',
  'wA',
  'wA',
  'wA',
  'wA',
  'wB',
  'wC',
  'wC',
  'wC',
  'wC',
])
assert.equal(
  collapseRecipientsToNftScatterPaste(['wA', 'wA', 'wA', 'wA', 'wA', 'wB', 'wC', 'wC', 'wC', 'wC']),
  'wA,5\nwB,1\nwC,4'
)

const weighted = pairScatterLines({
  mints: Array.from({ length: 10 }, (_, i) => ({ mint: `n${i}` })),
  entries: nftCountEntries,
  randomize: true,
})
assert.equal(weighted.ok, true)
if (weighted.ok) {
  assert.equal(weighted.lines.length, 10)
  const counts = new Map<string, number>()
  for (const line of weighted.lines) {
    counts.set(line.recipient, (counts.get(line.recipient) ?? 0) + 1)
  }
  assert.equal(counts.get('wA'), 5)
  assert.equal(counts.get('wB'), 1)
  assert.equal(counts.get('wC'), 4)
}

const weightedMismatch = pairScatterLines({
  mints: Array.from({ length: 9 }, (_, i) => ({ mint: `n${i}` })),
  entries: nftCountEntries,
  randomize: true,
})
assert.equal(weightedMismatch.ok, false)

const decimalCount = parseNftScatterEntries('wA,5.5')
assert.equal(decimalCount.length, 1)
assert.ok(Number.isNaN(decimalCount[0]!.count))
const badDecimalPair = pairScatterLines({
  mints: Array.from({ length: 5 }, (_, i) => ({ mint: `n${i}` })),
  entries: decimalCount,
  randomize: true,
})
assert.equal(badDecimalPair.ok, false)

// Space-separated count + bare wallet treated as 1 when mixed
const mixed = parseNftScatterEntries('wA 5\nwB\nwC,4')
assert.equal(mixed[0]!.count, 5)
assert.equal(mixed[1]!.count, null)
assert.equal(mixed[2]!.count, 4)
const mixedPair = pairScatterLines({
  mints: Array.from({ length: 10 }, (_, i) => ({ mint: `n${i}` })),
  entries: mixed,
  randomize: true,
})
assert.equal(mixedPair.ok, true)
if (mixedPair.ok) {
  assert.equal(mixedPair.lines.filter((l) => l.recipient === 'wB').length, 1)
}

const cost = buildOwlSendCostEstimate({ nftCount: 20, batchCount: 4, newAtaCount: 2 })
assert.ok(cost)
assert.equal(cost!.platformFeeSol, 0.02)
assert.ok(cost!.rentSolKnown != null && cost!.rentSolKnown > 0)

assert.equal(canAccessOwlSend({ isAdmin: true, publicOverride: false }), true)
assert.equal(canAccessOwlSend({ isAdmin: false, publicOverride: false }), false)
assert.equal(canAccessOwlSend({ isAdmin: false, publicOverride: true }), true)

// Resume remaining: keep recipient pairing, skip sent + not held
const planLines = [
  { mint: 'm0', recipient: 'r0' },
  { mint: 'm1', recipient: 'r1' },
  { mint: 'm2', recipient: 'r2' },
  { mint: 'm3', recipient: 'r3' },
  { mint: 'm4', recipient: 'r4' },
  { mint: 'm5', recipient: 'r5' },
]
const sessionSent = collectSentMintsFromBatches(
  [planLines.slice(0, 5), planLines.slice(5)],
  [
    { index: 0, status: 'done' },
    { index: 1, status: 'failed' },
  ]
)
assert.equal(sessionSent.size, 5)
assert.ok(sessionSent.has('m0'))
assert.ok(!sessionSent.has('m5'))

const ledgerSent = collectSentMintsFromLedger(
  [
    {
      asset_kind: 'nft',
      created_at: new Date().toISOString(),
      lines: [{ mint: 'm5' }],
    },
    {
      asset_kind: 'token',
      created_at: new Date().toISOString(),
      lines: [{ mint: 'ignored' }],
    },
  ],
  { nowMs: Date.now() }
)
assert.ok(ledgerSent.has('m5'))
assert.ok(!ledgerSent.has('ignored'))

const resume = buildResumeRemainingPlan({
  preparedLines: planLines,
  sentMints: new Set(['m0', 'm1', 'm2', 'm3', 'm4']),
  stillHeldMints: new Set(['m5', 'extra']),
})
assert.equal(resume.ok, true)
if (resume.ok) {
  assert.equal(resume.remaining.length, 1)
  assert.equal(resume.remaining[0]!.mint, 'm5')
  assert.equal(resume.remaining[0]!.recipient, 'r5')
  assert.equal(resume.batches.length, 1)
  assert.equal(resume.batchProgress[0]!.status, 'ready')
  assert.equal(resume.skippedSent, 5)
}

const resumeEmpty = buildResumeRemainingPlan({
  preparedLines: planLines,
  sentMints: new Set(planLines.map((l) => l.mint)),
  stillHeldMints: new Set(),
})
assert.equal(resumeEmpty.ok, false)

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

// Badge only for frozen (true nest lock); leftover CM delegates are not nested
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
    frozen: false,
    delegated: true,
  }),
  null
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
  'Marked frozen'
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

const merged = mergeDasNftsWithOnChainLocks(
  [
    {
      mint: 'mintA',
      tokenAccount: 'mintA',
      amount: '1',
      decimals: 0,
      metadataUri: null,
      name: 'Gen2 #1',
      image: null,
      collectionName: 'Gen2',
      frozen: true,
      delegated: true,
    },
  ],
  [
    {
      mint: 'mintA',
      tokenAccount: 'realAta',
      amount: '1',
      decimals: 0,
      metadataUri: null,
      name: null,
      image: null,
      collectionName: null,
      frozen: false,
      delegated: true,
    },
  ]
)
assert.equal(merged[0]!.tokenAccount, 'realAta')
assert.equal(merged[0]!.frozen, false)
assert.equal(merged[0]!.name, 'Gen2 #1')

assert.match(owlSendRetryHint('Owl #3 is frozen on-chain'), /Thaw locks|On-chain transfer rejected/)
assert.match(owlSendRetryHint('Could not find a transferable SPL'), /batch of 1|classic SPL/)
assert.match(owlSendRetryHint('User rejected the request'), /Wallet rejected/)

{
  const owner = Keypair.generate().publicKey
  const mint = Keypair.generate().publicKey
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID).toBase58()
  assert.equal(
    owlSendTokenAccountHint({ mint: mint.toBase58(), owner, tokenAccount: mint.toBase58() }),
    ata
  )
  assert.equal(
    owlSendTokenAccountHint({ mint: mint.toBase58(), owner, tokenAccount: ata }),
    ata
  )
}

console.log('test-owl-send-batch: ok')
