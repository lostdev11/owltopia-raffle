/**
 * Unit tests for packs inventory NFT eligibility (pNFT allowed; nest locks blocked).
 * Run: npx tsx scripts/test-packs-inventory-eligibility.ts
 *   or: npm run test:packs-inventory-eligibility
 */
import assert from 'node:assert/strict'
import {
  isPacksInventoryEligible,
  packsNftBlockReason,
} from '@/lib/packs/inventory-eligibility'
import type { WalletNft } from '@/lib/solana/wallet-tokens'

function nft(
  opts: Partial<Pick<WalletNft, 'interface' | 'compressed' | 'frozen' | 'delegated' | 'mint'>> = {}
): WalletNft {
  return {
    mint: opts.mint ?? 'Mint111111111111111111111111111111111111111',
    tokenAccount: 'Ata1111111111111111111111111111111111111111',
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: 'Test NFT',
    image: null,
    collectionName: null,
    compressed: opts.compressed ?? false,
    interface: opts.interface ?? 'V1_NFT',
    frozen: opts.frozen,
    delegated: opts.delegated,
  }
}

// Classic SPL — allowed
assert.equal(packsNftBlockReason(nft()), null)
assert.equal(isPacksInventoryEligible(nft()), true)

// pNFT (no lock) — allowed after vault TM payout support
assert.equal(packsNftBlockReason(nft({ interface: 'ProgrammableNFT' })), null)
assert.equal(isPacksInventoryEligible(nft({ interface: 'ProgrammableNFT' })), true)

// pNFT freeze without lock delegate — still transferable via Token Metadata
assert.equal(
  packsNftBlockReason(nft({ interface: 'ProgrammableNFT', frozen: true, delegated: false })),
  null
)

// pNFT frozen + delegated — nest/stake lock
assert.equal(
  packsNftBlockReason(nft({ interface: 'ProgrammableNFT', frozen: true, delegated: true })),
  'Frozen / nested / locked'
)
assert.equal(
  isPacksInventoryEligible(nft({ interface: 'ProgrammableNFT', frozen: true, delegated: true })),
  false
)

// Classic SPL frozen alone — locked
assert.equal(
  packsNftBlockReason(nft({ interface: 'V1_NFT', frozen: true, delegated: false })),
  'Frozen / nested / locked'
)

// Core / compressed — eligibility is not blocked by interface (deposit uses special path)
assert.equal(packsNftBlockReason(nft({ interface: 'MplCoreAsset' })), null)
assert.equal(packsNftBlockReason(nft({ compressed: true })), null)

console.log('test-packs-inventory-eligibility: ok')
