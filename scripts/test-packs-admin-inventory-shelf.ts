/**
 * Unit tests for admin pack inventory shelf labels and counts.
 * Run: npx tsx scripts/test-packs-admin-inventory-shelf.ts
 */
import assert from 'node:assert/strict'
import {
  packAdminInventoryMatchesShelfFilter,
  packAdminInventoryShelfSummary,
  packAdminShelfBadgeLabel,
  packAdminShelfSlugForInventoryRow,
} from '@/lib/packs/admin-inventory-shelf'
import { PACKS_PRODUCT_SLUG_MAIN, PACKS_PRODUCT_SLUG_OWL } from '@/lib/packs/product-pools'

const owlId = 'prod-owl'
const mainId = 'prod-main'
const products = [
  { id: owlId, slug: PACKS_PRODUCT_SLUG_OWL },
  { id: mainId, slug: PACKS_PRODUCT_SLUG_MAIN },
]

assert.equal(packAdminShelfBadgeLabel(PACKS_PRODUCT_SLUG_OWL), '$OWL shelf')
assert.equal(packAdminShelfBadgeLabel(PACKS_PRODUCT_SLUG_MAIN), 'Paid 0.1 SOL shelf')

assert.equal(
  packAdminShelfSlugForInventoryRow({ product_id: owlId }, products),
  PACKS_PRODUCT_SLUG_OWL
)
assert.equal(
  packAdminShelfSlugForInventoryRow({ product_id: mainId }, products),
  PACKS_PRODUCT_SLUG_MAIN
)
assert.equal(packAdminShelfSlugForInventoryRow({}, products), PACKS_PRODUCT_SLUG_MAIN)

const rows = [
  { product_id: owlId, status: 'available' },
  { product_id: owlId, status: 'paid' },
  { product_id: mainId, status: 'available' },
  { product_id: mainId, status: 'reserved' },
]

const summary = packAdminInventoryShelfSummary(rows, products)
assert.equal(summary.owl.available, 1)
assert.equal(summary.owl.outOfPool, 1)
assert.equal(summary.paid.available, 1)
assert.equal(summary.paid.outOfPool, 1)
assert.equal(summary.all.total, 4)

assert.equal(packAdminInventoryMatchesShelfFilter(rows[0]!, products, 'owl'), true)
assert.equal(packAdminInventoryMatchesShelfFilter(rows[2]!, products, 'owl'), false)
assert.equal(packAdminInventoryMatchesShelfFilter(rows[2]!, products, 'paid'), true)

console.log('test-packs-admin-inventory-shelf: ok')
