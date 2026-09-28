/**
 * Run: npx tsx scripts/test-enrich-collection-nft-self-labels.ts
 */
import assert from 'node:assert/strict'
import { enrichCollectionNftSelfLabels } from '../lib/helius/enrich-collection-nft-self-labels'
import { OWLTOPIA_GEN2_COLLECTION_MINT } from '../lib/owltopia-marketplace-links'
import {
  walletNftCollectionDisplayLabel,
  walletNftCollectionKey,
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

const GENBETA_COLLECTION = 'E5U1jxGenBetaCollectionMintAddress8DmBA6r2Ma'
const G2_ITEM = 'HfxTFaQeXHNBtcJq7q4z3XU98rSGDKhUVNoc34yYJY2d'

// --- GenBeta collection NFT + members (screenshot case) ---
{
  const list = [
    nft({
      mint: GENBETA_COLLECTION,
      name: 'GenBeta',
      symbol: null,
      collectionName: null,
      collectionMint: null,
    }),
    nft({
      mint: 'genbeta-139',
      name: 'GenBeta #139',
      collectionName: 'GenBeta',
      collectionMint: GENBETA_COLLECTION,
    }),
    nft({
      mint: 'genbeta-478',
      name: 'GenBeta #478',
      collectionName: 'GenBeta',
      collectionMint: GENBETA_COLLECTION,
    }),
  ]
  const enriched = enrichCollectionNftSelfLabels(list)
  const master = enriched.find((n) => n.mint === GENBETA_COLLECTION)!
  assert.equal(master.collectionName, 'GenBeta')
  assert.equal(walletNftCollectionDisplayLabel(master), 'GenBeta')
  assert.equal(walletNftCollectionKey(master), 'GenBeta')
  assert.equal(walletNftCollectionKey(enriched[1]!), 'GenBeta')
}

// --- Owltopia G2 collection mint + item (screenshot case) ---
{
  const list = [
    nft({
      mint: OWLTOPIA_GEN2_COLLECTION_MINT,
      name: 'Owltopia G2',
      symbol: 'OWL2',
      collectionName: null,
      collectionMint: null,
    }),
    nft({
      mint: G2_ITEM,
      name: 'Owltopia G2 #1083',
      symbol: 'OWL2',
      collectionName: 'Owltopia G2',
      collectionMint: OWLTOPIA_GEN2_COLLECTION_MINT,
    }),
  ]
  const enriched = enrichCollectionNftSelfLabels(list)
  const master = enriched.find((n) => n.mint === OWLTOPIA_GEN2_COLLECTION_MINT)!
  assert.equal(master.collectionName, 'Owltopia G2')
  assert.equal(walletNftCollectionDisplayLabel(master), 'Owltopia G2')
  assert.notEqual(walletNftCollectionDisplayLabel(master), 'No collection')
}

// --- Known Gen2 collection mint alone (no peers in wallet) ---
{
  const list = [
    nft({
      mint: OWLTOPIA_GEN2_COLLECTION_MINT,
      name: 'Owltopia Gen2',
      collectionName: null,
      collectionMint: null,
    }),
  ]
  const enriched = enrichCollectionNftSelfLabels(list)
  assert.equal(enriched[0]!.collectionName, 'Owltopia Gen2')
}

// --- Peer has collectionMint but no name yet: fall back to master asset name ---
{
  const list = [
    nft({ mint: 'col-mint-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'PartnerDrop' }),
    nft({
      mint: 'item-1',
      name: 'PartnerDrop #1',
      collectionMint: 'col-mint-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      collectionName: null,
    }),
  ]
  const enriched = enrichCollectionNftSelfLabels(list)
  assert.equal(enriched[0]!.collectionName, 'PartnerDrop')
}

// --- Unrelated NFT with no collection stays unlabeled ---
{
  const list = [nft({ mint: 'one-of-one-mint', name: 'Lonely 1/1' })]
  const enriched = enrichCollectionNftSelfLabels(list)
  assert.equal(enriched[0]!.collectionName, null)
  assert.equal(walletNftCollectionDisplayLabel(enriched[0]!), 'No collection')
}

// --- Already-labeled NFTs are left alone ---
{
  const list = [
    nft({
      mint: GENBETA_COLLECTION,
      name: 'GenBeta',
      collectionName: 'Already labeled',
      collectionMint: null,
    }),
    nft({
      mint: 'genbeta-1',
      name: 'GenBeta #1',
      collectionName: 'GenBeta',
      collectionMint: GENBETA_COLLECTION,
    }),
  ]
  const enriched = enrichCollectionNftSelfLabels(list)
  assert.equal(enriched[0]!.collectionName, 'Already labeled')
}

console.log('enrich-collection-nft-self-labels: ok')
