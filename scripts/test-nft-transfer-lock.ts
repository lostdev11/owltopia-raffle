/**
 * Unit tests for pNFT-aware transfer-lock helpers (raffle create / picker badges).
 * Run: npx tsx scripts/test-nft-transfer-lock.ts
 */
import assert from 'node:assert/strict'
import {
  isProgrammableNftInterface,
  isSplNftTransferLocked,
  isWalletNftTransferLocked,
} from '@/lib/solana/nft-transfer-lock'
import { owlSendNftLockLabel, partitionOwlSendByFrozen } from '@/lib/owl-send/picker-eligibility'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

function baseNft(overrides: Partial<WalletNft> = {}): WalletNft {
  return {
    mint: 'm',
    tokenAccount: 't',
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: null,
    image: null,
    collectionName: null,
    frozen: false,
    delegated: false,
    interface: null,
    ...overrides,
  }
}

assert.equal(isProgrammableNftInterface('ProgrammableNFT'), true)
assert.equal(isProgrammableNftInterface('V1_NFT'), false)
assert.equal(isProgrammableNftInterface(null), false)

// Classic: frozen alone is a lock
assert.equal(isSplNftTransferLocked({ frozen: true, delegated: false }), true)
assert.equal(isSplNftTransferLocked({ frozen: true, delegated: true }), true)
assert.equal(isSplNftTransferLocked({ frozen: false, delegated: true }), false)

// pNFT: need freeze AND delegate
assert.equal(
  isSplNftTransferLocked({ frozen: true, delegated: false, programmableNft: true }),
  false
)
assert.equal(
  isSplNftTransferLocked({ frozen: true, delegated: true, programmableNft: true }),
  true
)
assert.equal(
  isSplNftTransferLocked({ frozen: false, delegated: false, programmableNft: true }),
  false
)

// Meego-style DAS row: frozen, no delegate, ProgrammableNFT → not locked
const meego = baseNft({
  mint: 'meego',
  frozen: true,
  delegated: false,
  interface: 'ProgrammableNFT',
})
assert.equal(isWalletNftTransferLocked(meego), false)
assert.equal(owlSendNftLockLabel(meego), null)

// Nested Gen2: frozen + delegate → locked badge
const nested = baseNft({
  mint: 'nested',
  frozen: true,
  delegated: true,
  interface: 'V1_NFT',
})
assert.equal(isWalletNftTransferLocked(nested), true)
assert.equal(owlSendNftLockLabel(nested), 'Nested / frozen')

// Leftover CM delegate without freeze → sendable
const leftoverCm = baseNft({
  mint: 'leftover',
  frozen: false,
  delegated: true,
  interface: 'V1_NFT',
})
assert.equal(isWalletNftTransferLocked(leftoverCm), false)
assert.equal(owlSendNftLockLabel(leftoverCm), null)

// Classic frozen without interface hint → locked (safe default)
assert.equal(isWalletNftTransferLocked(baseNft({ mint: 'classic', frozen: true, delegated: false })), true)

const part = partitionOwlSendByFrozen([meego, nested, leftoverCm])
assert.equal(part.sendable.length, 2)
assert.equal(part.frozen.length, 1)
assert.equal(part.frozen[0]!.mint, 'nested')
assert.ok(part.sendable.some((n) => n.interface === 'ProgrammableNFT'))
assert.ok(part.sendable.some((n) => n.mint === 'leftover'))

console.log('test-nft-transfer-lock: ok')
