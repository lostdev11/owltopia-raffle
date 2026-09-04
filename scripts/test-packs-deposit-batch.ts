/**
 * Unit tests for packs inventory deposit batching.
 * Run: npx tsx scripts/test-packs-deposit-batch.ts
 */
import assert from 'node:assert/strict'
import {
  chunkPackDepositBatches,
  estimatePackDepositApprovals,
  halvePackDepositChunk,
  packDepositNeedsSpecialPath,
  PACK_DEPOSIT_MAX_PER_TX,
  rewriteOwlSendCopyForPacks,
  walletNftsToPackDepositLines,
} from '@/lib/packs/deposit-nft-batch-plan'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

function nft(
  mint: string,
  opts: Partial<Pick<WalletNft, 'compressed' | 'interface' | 'name'>> = {}
): WalletNft {
  return {
    mint,
    tokenAccount: `${mint}-ata`,
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: opts.name ?? mint.slice(0, 6),
    image: null,
    collectionName: null,
    compressed: opts.compressed ?? false,
    interface: opts.interface ?? 'V1_NFT',
  }
}

assert.equal(PACK_DEPOSIT_MAX_PER_TX, 3)

assert.equal(packDepositNeedsSpecialPath(nft('a')), false)
assert.equal(packDepositNeedsSpecialPath(nft('b', { compressed: true })), true)
assert.equal(packDepositNeedsSpecialPath(nft('c', { interface: 'MplCoreAsset' })), true)
assert.equal(packDepositNeedsSpecialPath(nft('d', { interface: 'ProgrammableNFT' })), true)

const tenClassic = Array.from({ length: 10 }, (_, i) => nft(`mint${i}`))
const classicChunks = chunkPackDepositBatches(tenClassic)
assert.equal(classicChunks.length, 4) // 3+3+3+1
assert.equal(classicChunks[0]!.length, 3)
assert.equal(classicChunks[1]!.length, 3)
assert.equal(classicChunks[2]!.length, 3)
assert.equal(classicChunks[3]!.length, 1)
assert.equal(estimatePackDepositApprovals(tenClassic), 4)
assert.equal(estimatePackDepositApprovals(tenClassic, { signAllClassic: true }), 1)

const mixed = [
  nft('s1'),
  nft('s2'),
  nft('core1', { interface: 'MplCoreAsset' }),
  nft('s3'),
  nft('cnft1', { compressed: true }),
  nft('s4'),
  nft('s5'),
  nft('s6'),
  nft('s7'),
]
const mixedChunks = chunkPackDepositBatches(mixed)
// s1,s2 | core1 | s3 | cnft1 | s4,s5,s6 | s7
assert.equal(mixedChunks.length, 6)
assert.deepEqual(
  mixedChunks.map((c) => c.map((n) => n.mint)),
  [['s1', 's2'], ['core1'], ['s3'], ['cnft1'], ['s4', 's5', 's6'], ['s7']]
)
assert.equal(estimatePackDepositApprovals(mixed), 6)
// sign-all collapses 4 classic txs → 1 sheet + 2 special = 3
assert.equal(estimatePackDepositApprovals(mixed, { signAllClassic: true }), 3)

const lines = walletNftsToPackDepositLines([nft('m1', { name: 'Owl #1' })], 'Vault111')
assert.equal(lines.length, 1)
assert.equal(lines[0]!.recipient, 'Vault111')
assert.equal(lines[0]!.mint, 'm1')
assert.equal(lines[0]!.name, 'Owl #1')

assert.equal(
  rewriteOwlSendCopyForPacks('OwlSend will use a smaller approval — tap Retry.'),
  'Pack deposit will use a smaller batch — retry deposit.'
)

assert.deepEqual(
  halvePackDepositChunk([1, 2, 3, 4]).map((c) => c.length),
  [2, 2]
)
assert.deepEqual(halvePackDepositChunk([1]), [[1]])

console.log('test-packs-deposit-batch: ok')
