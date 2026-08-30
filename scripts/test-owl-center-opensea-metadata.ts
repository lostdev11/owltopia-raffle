import assert from 'node:assert/strict'

import {
  buildOpenSeaTokenMetadata,
  openSeaImageUri,
  OPENSEA_IMAGE_PLACEHOLDER,
  serializeOpenSeaTokenMetadata,
} from '../lib/owl-center/generator/opensea-metadata'
import type { GeneratedNft, GeneratorProject } from '../lib/owl-center/generator/types'

const project: GeneratorProject = {
  id: 'test-project',
  name: 'Test Owls',
  collectionName: 'Night Owls',
  symbol: 'NOWL',
  description: 'A test collection.',
  categories: [
    { id: 'bg', name: 'Background', zIndex: 0 },
    { id: 'hat', name: 'Hat', zIndex: 10 },
  ],
  traits: [],
  rules: [],
  updatedAt: new Date().toISOString(),
}

const nft: GeneratedNft = {
  index: 7,
  dna: 'abc',
  traits: [],
  attributes: [
    { trait_type: 'Background', value: 'Midnight' },
    { trait_type: 'Hat', value: 'Wizard + Crown' },
  ],
}

const meta = buildOpenSeaTokenMetadata(project, nft)
assert.equal(meta.name, 'Night Owls #7')
assert.match(meta.description, /test collection/i)
assert.equal(meta.image, `${OPENSEA_IMAGE_PLACEHOLDER}/images/7.png`)
assert.deepEqual(meta.attributes, [
  { trait_type: 'Background', value: 'Midnight' },
  { trait_type: 'Hat', value: 'Wizard + Crown' },
])
assert.equal('symbol' in meta, false)
assert.equal('properties' in meta, false)

const withBase = buildOpenSeaTokenMetadata(project, nft, { baseUri: 'ipfs://bafyTEST/' })
assert.equal(withBase.image, 'ipfs://bafyTEST/images/7.png')

assert.equal(openSeaImageUri(0, 'https://cdn.example.com/collection'), 'https://cdn.example.com/collection/images/0.png')

const serialized = serializeOpenSeaTokenMetadata(project, nft)
const parsed = JSON.parse(serialized) as Record<string, unknown>
assert.equal(parsed.name, 'Night Owls #7')
assert.ok(Array.isArray(parsed.attributes))
assert.equal(parsed.symbol, undefined)
assert.equal(parsed.properties, undefined)

console.log('test-owl-center-opensea-metadata: ok')
