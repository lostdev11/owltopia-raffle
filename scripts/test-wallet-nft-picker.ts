import assert from 'node:assert/strict'
import {
  filterWalletNfts,
  groupWalletNftsByCollection,
  sortWalletNfts,
  walletNftCollectionDisplayLabel,
  walletNftCollectionLabel,
  walletNftMintMatches,
} from '../lib/raffles/wallet-nft-picker'
import type { WalletNft } from '../lib/solana/wallet-tokens'

function nft(partial: Partial<WalletNft> & Pick<WalletNft, 'mint'>): WalletNft {
  return {
    mint: partial.mint,
    tokenAccount: partial.tokenAccount ?? partial.mint,
    amount: '1',
    decimals: 0,
    metadataUri: null,
    name: partial.name ?? null,
    image: null,
    collectionName: partial.collectionName ?? null,
    collectionMint: partial.collectionMint ?? null,
    symbol: partial.symbol ?? null,
  }
}

const sample: WalletNft[] = [
  nft({ mint: 'mint-a', name: 'Alpha #1', collectionName: 'Owls' }),
  nft({ mint: 'mint-b', name: 'Beta #2', collectionName: 'Owls' }),
  nft({ mint: 'mint-c', name: 'Gamma', collectionName: 'Frogs' }),
  nft({ mint: 'mint-d', name: 'Delta' }),
]

assert.equal(groupWalletNftsByCollection(sample).length, 3)
assert.equal(walletNftCollectionLabel('__uncategorized__'), 'Other / no collection')

const owlsOnly = filterWalletNfts({
  nfts: sample,
  searchQuery: '',
  collectionKey: 'Owls',
})
assert.equal(owlsOnly.length, 2)

const bySymbol = filterWalletNfts({
  nfts: [nft({ mint: 'x', name: 'Item', symbol: 'OWL' })],
  searchQuery: 'owl',
  collectionKey: 'all',
})
assert.equal(bySymbol.length, 1)

const sorted = sortWalletNfts(sample, 'collection')
assert.equal(sorted[0].collectionName, 'Frogs')

assert.equal(walletNftMintMatches('AbC', 'abc'), true)

assert.equal(walletNftCollectionDisplayLabel(nft({ mint: 'x', collectionName: 'Owls' })), 'Owls')
assert.equal(
  walletNftCollectionDisplayLabel(nft({ mint: 'x', collectionMint: 'CollectionMintAddress1234567890' })),
  'Coll…7890'
)
assert.equal(walletNftCollectionDisplayLabel(nft({ mint: 'x' })), 'No collection')

console.log('wallet-nft-picker utils: ok')
