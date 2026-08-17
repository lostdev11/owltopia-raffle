/**
 * Unit checks for Orbis marketplace URL helpers + readiness gating semantics.
 * Run: npx --yes tsx scripts/test-orbis-marketplace-urls.ts
 */
import assert from 'node:assert/strict'

import {
  orbisListCollectionUrl,
  suggestMagicEdenCollectionUrl,
  suggestOrbisCollectionUrl,
  suggestTensorCollectionUrl,
} from '../lib/owl-center/marketplace-urls'

assert.equal(orbisListCollectionUrl(), 'https://www.orbisonsol.io/marketplace#list')
assert.equal(suggestOrbisCollectionUrl('owltopia-g2'), 'https://www.orbisonsol.io/marketplace/owltopia-g2')
assert.equal(suggestOrbisCollectionUrl('  /owltopia/  '), 'https://www.orbisonsol.io/marketplace/owltopia')
assert.equal(suggestOrbisCollectionUrl(''), '')
assert.ok(suggestMagicEdenCollectionUrl('So11111111111111111111111111111111111111112').includes('magiceden.io'))
assert.ok(suggestTensorCollectionUrl('So11111111111111111111111111111111111111112').includes('tensor.trade'))

/** Mirrors syncLaunchMarketplaceFieldsFromRow readiness rule. */
function marketplaceReady(orbisStatus: string, meStatus: string, teStatus: string): boolean {
  const terminal = new Set(['LISTED', 'CLAIMED', 'VERIFIED'])
  return terminal.has(orbisStatus) || (terminal.has(meStatus) && terminal.has(teStatus))
}

assert.equal(marketplaceReady('LISTED', 'NOT_READY', 'NOT_READY'), true)
assert.equal(marketplaceReady('NOT_READY', 'LISTED', 'LISTED'), true)
assert.equal(marketplaceReady('NOT_READY', 'LISTED', 'NOT_READY'), false)
assert.equal(marketplaceReady('READY_FOR_INDEXING', 'NOT_READY', 'NOT_READY'), false)

console.log('ok — orbis marketplace urls + readiness gating')
