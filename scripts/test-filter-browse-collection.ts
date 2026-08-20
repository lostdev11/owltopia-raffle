/**
 * Collection mint browse filter.
 * Run: npx tsx scripts/test-filter-browse-collection.ts
 */
import assert from 'node:assert/strict'
import type { Raffle } from '../lib/types'
import {
  collectionMintFilterFromSearchParam,
  filterRafflesBrowseList,
  raffleMatchesCollectionFilter,
} from '../lib/raffles/filter-browse-raffles'
import {
  classifyCollectionResolve,
  collectCollectionCandidates,
} from '../lib/raffles/resolve-collection-filter'

const colA = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const colB = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const host = 'So11111111111111111111111111111111111111112'

function stubRaffle(partial: {
  id: string
  title: string
  nft_collection_mint: string | null
  nft_collection_name?: string | null
}): Raffle {
  return {
    id: partial.id,
    slug: partial.id,
    title: partial.title,
    creator_wallet: host,
    nft_collection_mint: partial.nft_collection_mint,
    nft_collection_name: partial.nft_collection_name ?? null,
  } as Raffle
}

const raffles = [
  stubRaffle({ id: '1', title: 'Mad Lad #1', nft_collection_mint: colA, nft_collection_name: 'Mad Lads' }),
  stubRaffle({ id: '2', title: 'USDC bag', nft_collection_mint: colB, nft_collection_name: 'USD Coin' }),
  stubRaffle({ id: '3', title: 'One of one', nft_collection_mint: null, nft_collection_name: 'Custom' }),
]

assert.equal(raffleMatchesCollectionFilter(raffles[0]!, colA), true)
assert.equal(raffleMatchesCollectionFilter(raffles[0]!, colB), false)
assert.equal(raffleMatchesCollectionFilter(raffles[0]!, null), true)
assert.equal(raffleMatchesCollectionFilter(raffles[2]!, colA), false)

const filtered = filterRafflesBrowseList(
  raffles.map((raffle) => ({ raffle })),
  { query: '', ticketCurrency: null, prize: null, collectionMint: colA }
)
assert.equal(filtered.length, 1)
assert.equal(filtered[0]!.raffle.id, '1')

const candidates = collectCollectionCandidates(raffles)
assert.equal(candidates.length, 2)

const byName = classifyCollectionResolve('Mad Lads', candidates)
assert.equal(byName.status, 'one')
if (byName.status === 'one') {
  assert.equal(byName.collection.mint, colA)
}

const byMint = classifyCollectionResolve(colB, candidates)
assert.equal(byMint.status, 'one')
if (byMint.status === 'one') {
  assert.equal(byMint.collection.mint, colB)
}

assert.equal(classifyCollectionResolve('Nobody', candidates).status, 'none')
assert.equal(collectionMintFilterFromSearchParam(colA), colA)
assert.equal(collectionMintFilterFromSearchParam(''), null)
assert.equal(collectionMintFilterFromSearchParam(null), null)

console.log('test-filter-browse-collection: ok')
