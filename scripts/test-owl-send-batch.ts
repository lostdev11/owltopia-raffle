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
  buildResumeSkippingFrozenPlan,
  collectSentMintsFromBatches,
  collectSentMintsFromLedger,
} from '@/lib/owl-send/resume'
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { attributeOwlSendFrozenFailures } from '@/lib/owl-send/attribute-batch-failure'
import {
  clearUnconfirmedDasFrozen,
  mergeDasNftsWithOnChainLocks,
} from '@/lib/owl-send/merge-onchain-nft-locks'
import {
  gateOwlSendCnftSelection,
  owlSendNftLockLabel,
  owlSendSkippedFrozenNotice,
  partitionOwlSendByFrozen,
} from '@/lib/owl-send/picker-eligibility'
import { owlSendTokenAccountHint } from '@/lib/owl-send/resolve-spl-holder'
import { owlSendRetryHint } from '@/lib/owl-send/retry-hint'
import {
  isOwlSendFrozenTransferError,
  isOwlSendWalletExtensionError,
  owlSendWalletExtensionHint,
} from '@/lib/owl-send/wallet-send-errors'
import { OWL_SEND_MAX_PER_TX, OWL_SEND_MAX_SELECT } from '@/lib/owl-send/constants'
import {
  OWL_SEND_COMPUTE_UNIT_LIMIT,
  owlSendTxHasComputeBudget,
  prependOwlSendComputeBudget,
} from '@/lib/owl-send/compute-budget'
import { buildOwlSendCostEstimate } from '@/lib/owl-send/cost-estimate'
import { getOwlSendFeeLamportsForCount, getOwlSendFeeSol } from '@/lib/owl-send/fee'
import { canAccessOwlSend } from '@/lib/owl-send/access'

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

{
  const skipFrozen = buildResumeSkippingFrozenPlan({
    preparedLines: planLines,
    batches: [planLines.slice(0, 5), planLines.slice(5)],
    batchProgress: [
      { index: 0, status: 'failed' },
      { index: 1, status: 'pending' },
    ],
    frozenMints: ['m0', 'm5'],
  })
  assert.equal(skipFrozen.ok, true)
  if (skipFrozen.ok) {
    assert.equal(skipFrozen.skippedFrozen, 2)
    assert.deepEqual(
      skipFrozen.remaining.map((l) => l.mint),
      ['m1', 'm2', 'm3', 'm4']
    )
    assert.equal(skipFrozen.batches.length, 1)
  }

  const allFrozen = buildResumeSkippingFrozenPlan({
    preparedLines: [
      { mint: 'f1', recipient: 'r' },
      { mint: 'f2', recipient: 'r' },
    ],
    batches: [
      [
        { mint: 'f1', recipient: 'r' },
        { mint: 'f2', recipient: 'r' },
      ],
    ],
    batchProgress: [{ index: 0, status: 'failed' }],
    frozenMints: ['f1', 'f2'],
  })
  assert.equal(allFrozen.ok, false)
  if (!allFrozen.ok) assert.match(allFrozen.error, /Thaw locks|nested\/frozen/)
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
  'Nested / frozen'
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
assert.equal(merged[0]!.delegated, true)
assert.equal(merged[0]!.name, 'Gen2 #1')

// Truncated overlay (low coverage) → keep DAS frozen for mints the scan missed
{
  const keepStale = mergeDasNftsWithOnChainLocks(
    [
      {
        mint: 'missingOnChain',
        tokenAccount: 'missingOnChain',
        amount: '1',
        decimals: 0,
        metadataUri: null,
        name: 'Gen2 stale',
        image: null,
        collectionName: null,
        frozen: true,
        delegated: true,
      },
    ],
    [
      {
        mint: 'other',
        tokenAccount: 'otherAta',
        amount: '1',
        decimals: 0,
        metadataUri: null,
        name: null,
        image: null,
        collectionName: null,
        frozen: false,
        delegated: false,
      },
    ]
  )
  const stale = keepStale.find((n) => n.mint === 'missingOnChain')
  assert.equal(stale?.frozen, true)

  // Complete overlay (caller opts in) → clear DAS frozen for missing rows
  const dropStale = mergeDasNftsWithOnChainLocks(
    [
      {
        mint: 'missingOnChain',
        tokenAccount: 'missingOnChain',
        amount: '1',
        decimals: 0,
        metadataUri: null,
        name: 'Gen2 stale',
        image: null,
        collectionName: null,
        frozen: true,
        delegated: true,
      },
    ],
    [
      {
        mint: 'other',
        tokenAccount: 'otherAta',
        amount: '1',
        decimals: 0,
        metadataUri: null,
        name: null,
        image: null,
        collectionName: null,
        frozen: false,
        delegated: false,
      },
    ],
    { treatMissingAsThawed: true }
  )
  assert.equal(dropStale.find((n) => n.mint === 'missingOnChain')?.frozen, false)
}

// Overlay empty → clear unconfirmed DAS frozen
{
  const cleared = clearUnconfirmedDasFrozen([
    {
      mint: 'm1',
      tokenAccount: 'm1',
      amount: '1',
      decimals: 0,
      metadataUri: null,
      name: 'G2',
      image: null,
      collectionName: null,
      frozen: true,
      delegated: true,
    },
  ])
  assert.equal(cleared[0]!.frozen, false)
  assert.equal(cleared[0]!.delegated, true)
}

// Partition: skip frozen, keep sendable (leftover CM delegate alone stays sendable)
{
  const part = partitionOwlSendByFrozen([
    {
      mint: 'sendable',
      tokenAccount: 'ata1',
      amount: '1',
      decimals: 0,
      metadataUri: null,
      name: 'Gen2 #289',
      image: null,
      collectionName: null,
      frozen: false,
      delegated: true,
    },
    {
      mint: 'nested',
      tokenAccount: 'ata2',
      amount: '1',
      decimals: 0,
      metadataUri: null,
      name: 'Gen2 #1006',
      image: null,
      collectionName: null,
      frozen: true,
      delegated: true,
    },
  ])
  assert.equal(part.sendable.length, 1)
  assert.equal(part.sendable[0]!.mint, 'sendable')
  assert.equal(part.frozen.length, 1)
  assert.equal(part.frozen[0]!.mint, 'nested')
  assert.match(owlSendSkippedFrozenNotice(1, 1), /Continuing with the rest/)
  assert.match(owlSendSkippedFrozenNotice(2, 0), /unnest on Nesting first/)
}

// Failure attribution: only frozen mints land in failedMints
{
  const attributed = attributeOwlSendFrozenFailures({
    lines: [
      { mint: 'ok1', name: 'Gen2 #1' },
      { mint: 'frozen1', name: 'Gen2 #1006' },
      { mint: 'ok2', name: 'Gen2 #289' },
    ],
    frozenMints: ['frozen1'],
    baseError: 'Account is frozen',
  })
  assert.deepEqual(attributed.failedMints, ['frozen1'])
  assert.match(attributed.error, /Gen2 #1006/)
  assert.match(attributed.error, /the others are fine/)

  const noFrozen = attributeOwlSendFrozenFailures({
    lines: [
      { mint: 'a', name: 'A' },
      { mint: 'b', name: 'B' },
    ],
    frozenMints: [],
    baseError: 'Wallet rejected',
  })
  assert.deepEqual(noFrozen.failedMints, ['a', 'b'])
  assert.equal(noFrozen.error, 'Wallet rejected')
}

assert.match(owlSendRetryHint('Owl #3 is frozen on-chain'), /Thaw locks|On-chain transfer rejected/)
assert.match(owlSendRetryHint('Could not find a transferable SPL'), /cNFT|alone|Deselect/)
assert.match(
  owlSendRetryHint('Could not establish connection. Receiving end does not exist.'),
  /Open your wallet|Jupiter|unreachable|reconnect/
)
assert.match(owlSendRetryHint(owlSendWalletExtensionHint('Jupiter')), /Jupiter|unreachable|globe/)
assert.equal(isOwlSendWalletExtensionError('Could not establish connection. Receiving end does not exist.'), true)
assert.equal(isOwlSendWalletExtensionError('Account is frozen'), false)
assert.equal(isOwlSendFrozenTransferError('Account is frozen'), true)
assert.equal(isOwlSendFrozenTransferError(owlSendWalletExtensionHint()), false)

assert.equal(
  owlSendNftLockLabel({
    mint: 'c1',
    tokenAccount: 'c1',
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: 'Compressed',
    image: null,
    collectionName: null,
    compressed: true,
  }),
  'cNFT'
)
{
  const gate = gateOwlSendCnftSelection([
    {
      mint: 'g2',
      tokenAccount: 'ata',
      amount: '1',
      decimals: 0,
      metadataUri: null,
      name: 'Gen2',
      image: null,
      collectionName: null,
      compressed: false,
    },
    {
      mint: 'c1',
      tokenAccount: 'c1',
      amount: '1',
      decimals: 0,
      metadataUri: null,
      name: 'cNFT',
      image: null,
      collectionName: null,
      compressed: true,
    },
  ])
  assert.equal(gate.ok, false)
  if (!gate.ok) assert.match(gate.title, /separately/i)
}
assert.match(owlSendRetryHint('User rejected the request'), /Wallet rejected/)

{
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: Keypair.generate().publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 1,
    })
  )
  assert.equal(owlSendTxHasComputeBudget(tx), false)
  prependOwlSendComputeBudget(tx)
  assert.equal(owlSendTxHasComputeBudget(tx), true)
  assert.equal(tx.instructions.length, 3)
  assert.ok(OWL_SEND_COMPUTE_UNIT_LIMIT > 200_000)
  // idempotent
  prependOwlSendComputeBudget(tx)
  assert.equal(tx.instructions.length, 3)
}

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
