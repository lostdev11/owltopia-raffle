/**
 * Unit tests for Owl Center collection-name mint slugs.
 * Run: npx tsx scripts/test-owl-center-launch-slug.ts
 */
import assert from 'node:assert/strict'
import {
  allocateUniqueLaunchSlug,
  isOpaqueOwlCenterLaunchSlug,
  isValidOwlCenterLaunchSlug,
  parseOwlCenterCollectionSlugParam,
  slugifyOwlCenterLaunchName,
} from '../lib/owl-center/launch-slug'
import { mintCanonicalPath, mintCanonicalUrl, mintShortPath } from '../lib/owl-center/mint-share'

assert.equal(slugifyOwlCenterLaunchName('Cool Owls'), 'cool-owls')
assert.equal(slugifyOwlCenterLaunchName('  GEN-2  Owls!! '), 'gen-2-owls')
assert.equal(slugifyOwlCenterLaunchName('GEN2'), 'collection')
assert.equal(slugifyOwlCenterLaunchName('Owl Center'), 'collection')
assert.equal(slugifyOwlCenterLaunchName('***'), 'collection')
assert.equal(slugifyOwlCenterLaunchName('NPP #3967'), 'npp-3967')
assert.equal(slugifyOwlCenterLaunchName('Free Mint Airdrop Claim Now'), 'collection')
assert.equal(slugifyOwlCenterLaunchName('Legendary Dumpster Owls'), 'dumpster-owls')

assert.equal(isOpaqueOwlCenterLaunchSlug('sub-55d9e2aeb5ac452eb6a378897987633e'), true)
assert.equal(isOpaqueOwlCenterLaunchSlug('cool-owls'), false)
assert.equal(isOpaqueOwlCenterLaunchSlug('sub-not-a-uuid'), false)

assert.equal(isValidOwlCenterLaunchSlug('cool-owls'), true)
assert.equal(isValidOwlCenterLaunchSlug('gen2'), false)
assert.equal(isValidOwlCenterLaunchSlug('Cool-Owls'), false)

assert.equal(parseOwlCenterCollectionSlugParam('Cool-Owls'), 'cool-owls')
assert.equal(parseOwlCenterCollectionSlugParam('gen2'), null)
assert.equal(parseOwlCenterCollectionSlugParam('sub-55d9e2aeb5ac452eb6a378897987633e'), 'sub-55d9e2aeb5ac452eb6a378897987633e')

assert.equal(allocateUniqueLaunchSlug('Cool Owls', new Set()), 'cool-owls')
assert.equal(
  allocateUniqueLaunchSlug('Cool Owls', new Set(['cool-owls'])),
  'cool-owls-2'
)
assert.equal(
  allocateUniqueLaunchSlug('Cool Owls', new Set(['cool-owls', 'cool-owls-2'])),
  'cool-owls-3'
)
assert.equal(allocateUniqueLaunchSlug('gen2', new Set()), 'collection-2')

assert.equal(mintShortPath('cool-owls'), '/m/cool-owls')
assert.equal(mintCanonicalPath('cool-owls'), '/owl-center/collection/cool-owls')
assert.equal(
  mintCanonicalUrl('https://www.owltopia.xyz', 'cool-owls'),
  'https://www.owltopia.xyz/owl-center/collection/cool-owls'
)

console.log('test-owl-center-launch-slug: ok')
