/**
 * Unit tests for OwlSend mixed-asset approval queue (POC).
 * Run: npx tsx scripts/test-owl-send-approval-queue.ts
 */
import assert from 'node:assert/strict'
import {
  classifyOwlSendAssetKind,
  owlSendKindByMintFromNfts,
  owlSendMaxPerTxForKind,
  packOwlSendApprovalQueue,
  previewOwlSendApprovalQueue,
} from '@/lib/owl-send/approval-queue'
import type { WalletNft } from '@/lib/solana/wallet-tokens'
import type { OwlSendLine } from '@/lib/owl-send/batch'

function nft(overrides: Partial<WalletNft> & { mint: string }): WalletNft {
  return {
    tokenAccount: overrides.mint,
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: overrides.name ?? null,
    image: null,
    collectionName: null,
    frozen: false,
    delegated: false,
    interface: null,
    compressed: false,
    ...overrides,
  }
}

assert.equal(classifyOwlSendAssetKind(nft({ mint: 'a', interface: 'V1_NFT' })), 'classic')
assert.equal(classifyOwlSendAssetKind(nft({ mint: 'b', interface: 'ProgrammableNFT' })), 'pnft')
assert.equal(classifyOwlSendAssetKind(nft({ mint: 'c', interface: 'MplCoreAsset' })), 'core')
assert.equal(classifyOwlSendAssetKind(nft({ mint: 'd', compressed: true })), 'cnft')
assert.equal(owlSendMaxPerTxForKind('classic'), 4)
assert.equal(owlSendMaxPerTxForKind('pnft'), 1)

{
  // Mixed bag: 6 classic + 2 pNFT + 1 cNFT → 2 classic approvals + 2 pNFT + 1 cNFT = 5
  const selected = [
    ...Array.from({ length: 6 }, (_, i) => nft({ mint: `c${i}`, interface: 'V1_NFT' })),
    nft({ mint: 'p0', interface: 'ProgrammableNFT', frozen: true, delegated: false }),
    nft({ mint: 'p1', interface: 'ProgrammableNFT' }),
    nft({ mint: 'z0', compressed: true }),
  ]
  const preview = previewOwlSendApprovalQueue(selected)
  assert.equal(preview.totalApprovals, 5)
  assert.ok(preview.summary.includes('5 wallet approvals'))
  assert.equal(preview.byKind.find((k) => k.kind === 'classic')?.approvals, 2)
  assert.equal(preview.byKind.find((k) => k.kind === 'pnft')?.approvals, 2)
  assert.equal(preview.byKind.find((k) => k.kind === 'cnft')?.approvals, 1)

  const lines: OwlSendLine[] = selected.map((n) => ({
    mint: n.mint,
    recipient: 'Recipient1111111111111111111111111111111',
    name: n.name,
  }))
  const queue = packOwlSendApprovalQueue({
    lines,
    kindByMint: owlSendKindByMintFromNfts(selected),
  })
  assert.equal(queue.length, 5)
  // Classic first — recipient-aware pack (same wallet → ≤4)
  assert.equal(queue[0]!.kind, 'classic')
  assert.equal(queue[0]!.lines.length, 4)
  assert.equal(queue[1]!.kind, 'classic')
  assert.equal(queue[1]!.lines.length, 2)
  assert.equal(queue[2]!.kind, 'pnft')
  assert.equal(queue[2]!.lines.length, 1)
  assert.equal(queue[3]!.kind, 'pnft')
  assert.equal(queue[4]!.kind, 'cnft')
  assert.ok(queue[2]!.why.toLowerCase().includes('pnft') || queue[2]!.why.includes('Token Metadata'))
  // Never mix kinds inside one approval
  for (const chunk of queue) {
    const kinds = new Set(
      chunk.lines.map((l) => classifyOwlSendAssetKind(selected.find((n) => n.mint === l.mint)!))
    )
    assert.equal(kinds.size, 1)
  }
}

console.log('test-owl-send-approval-queue: ok')
