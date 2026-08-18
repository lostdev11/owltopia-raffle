/**
 * Off-chain Metaplex JSON must include seller_fee_basis_points + properties.creators
 * so explorers (Orb, etc.) show Owl Center royalties.
 *
 *   npx tsx scripts/test-metadata-royalty.ts
 */
import assert from 'node:assert/strict'

import {
  applyMetaplexRoyaltyFields,
  coreRoyaltiesPluginFromLaunch,
  metadataJsonNeedsRoyaltyFields,
  metadataRoyaltyFromLaunch,
  rewriteMetadataJson,
  uploadedUriByBasename,
} from '../lib/owl-center/metadata-royalty'
import type { OwlCenterLaunchPublic } from '../lib/owl-center/types'

const CREATOR = 'DNoggcEL6DGdQAjaqxK7v5ktZchvXKtZdkaN6FPx2Fj1'

function launch(
  overrides: Partial<Pick<OwlCenterLaunchPublic, 'seller_fee_basis_points' | 'royalty_splits' | 'creator_wallet'>> = {}
) {
  return {
    seller_fee_basis_points: 1000,
    royalty_splits: [{ address: CREATOR, share: 100 }],
    creator_wallet: CREATOR,
    ...overrides,
  }
}

const royalty = metadataRoyaltyFromLaunch(launch())
assert.equal(royalty.sellerFeeBasisPoints, 1000)
assert.deepEqual(royalty.creators, [{ address: CREATOR, share: 100 }])

const missing = {
  name: 'Breppe OG #45',
  symbol: 'Brep',
  image: '45.png',
  properties: { files: [{ uri: '45.png', type: 'image/png' }], category: 'image' },
}
assert.equal(metadataJsonNeedsRoyaltyFields(missing), true)

const stamped = applyMetaplexRoyaltyFields({ ...missing, properties: { ...missing.properties } }, royalty)
assert.equal(stamped.seller_fee_basis_points, 1000)
assert.equal(metadataJsonNeedsRoyaltyFields(stamped), false)
const creators = (stamped.properties as { creators: Array<{ address: string; share: number; verified: boolean }> }).creators
assert.equal(creators.length, 1)
assert.equal(creators[0]?.address, CREATOR)
assert.equal(creators[0]?.share, 100)
assert.equal(creators[0]?.verified, false)

const zero = metadataRoyaltyFromLaunch(launch({ seller_fee_basis_points: 0 }))
assert.equal(zero.sellerFeeBasisPoints, 0)
const zeroJson = applyMetaplexRoyaltyFields({ name: 'x' }, zero)
assert.equal(zeroJson.seller_fee_basis_points, 0)
assert.equal(metadataJsonNeedsRoyaltyFields(zeroJson), false)

const rewritten = JSON.parse(
  rewriteMetadataJson(
    JSON.stringify(missing),
    'https://gateway.irys.xyz/token-image',
    '45.png',
    royalty
  )
) as Record<string, unknown>
assert.equal(rewritten.image, 'https://gateway.irys.xyz/token-image?ext=png')
assert.equal(rewritten.seller_fee_basis_points, 1000)
const files = (rewritten.properties as { files: Array<{ uri: string }> }).files
assert.equal(files[0]?.uri, 'https://gateway.irys.xyz/token-image?ext=png')
const jsonCreators = (rewritten.properties as { creators: Array<{ address: string }> }).creators
assert.equal(jsonCreators[0]?.address, CREATOR)

const collectionRaw = JSON.stringify({
  name: 'Breppe OG',
  symbol: 'Brep',
  image: 'collection.png',
  properties: { files: [{ uri: 'collection.png', type: 'image/png' }], category: 'image' },
})
const collectionRewritten = JSON.parse(
  rewriteMetadataJson(collectionRaw, 'https://gateway.irys.xyz/collection-image', 'collection.png', royalty)
) as Record<string, unknown>
assert.equal(collectionRewritten.image, 'https://gateway.irys.xyz/collection-image?ext=png')
assert.equal(collectionRewritten.seller_fee_basis_points, 1000)

const alreadyExt = JSON.parse(
  rewriteMetadataJson(
    JSON.stringify(missing),
    'https://gateway.irys.xyz/token-image?ext=png',
    '45.png',
    royalty
  )
) as Record<string, unknown>
assert.equal(alreadyExt.image, 'https://gateway.irys.xyz/token-image?ext=png')

const plugin = coreRoyaltiesPluginFromLaunch(launch())
assert.ok(plugin)
assert.equal(plugin.type, 'Royalties')
assert.equal(plugin.basisPoints, 1000)
assert.deepEqual(plugin.creators, [{ address: CREATOR, percentage: 100 }])
assert.equal(
  coreRoyaltiesPluginFromLaunch({
    seller_fee_basis_points: 1000,
    royalty_splits: null,
    creator_wallet: '',
  }),
  null
)

const royaltyOnly = JSON.parse(rewriteMetadataJson(collectionRaw, null, 'collection.png', royalty)) as Record<
  string,
  unknown
>
assert.equal(royaltyOnly.image, 'collection.png')
assert.equal(royaltyOnly.seller_fee_basis_points, 1000)

assert.equal(
  uploadedUriByBasename({ 'assets/collection.png': 'https://gateway.irys.xyz/col' }, 'collection.png'),
  'https://gateway.irys.xyz/col'
)
assert.equal(uploadedUriByBasename({ 'assets/0.png': 'https://gateway.irys.xyz/z' }, 'collection.png'), null)
assert.equal(uploadedUriByBasename({ 'assets/0.png': 'https://gateway.irys.xyz/z' }, '0.png'), 'https://gateway.irys.xyz/z')

const overwritten = applyMetaplexRoyaltyFields(
  { seller_fee_basis_points: 500, properties: { creators: [{ address: 'old', share: 100 }] } },
  royalty
)
assert.equal(overwritten.seller_fee_basis_points, 1000)
assert.equal(
  (overwritten.properties as { creators: Array<{ address: string }> }).creators[0]?.address,
  CREATOR
)

const noCreatorWallet = metadataRoyaltyFromLaunch({
  seller_fee_basis_points: 500,
  royalty_splits: null,
  creator_wallet: '',
})
assert.equal(noCreatorWallet.sellerFeeBasisPoints, 500)
assert.equal(noCreatorWallet.creators.length, 0)

console.log('test-metadata-royalty: ok')
