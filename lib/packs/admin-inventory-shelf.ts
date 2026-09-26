import {
  isOwlCheckoutProductSlug,
  PACKS_PRODUCT_SLUG_MAIN,
  PACKS_PRODUCT_SLUG_OWL,
} from '@/lib/packs/product-pools'
import type { PackInventoryStatus } from '@/lib/packs/types'

export type PackAdminInventoryShelfFilter = 'all' | 'owl' | 'paid'

export type PackAdminProductRef = {
  id: string
  slug: string
  name?: string
}

export type PackAdminShelfCounts = {
  available: number
  outOfPool: number
  total: number
}

export type PackAdminInventoryShelfSummary = {
  all: PackAdminShelfCounts
  owl: PackAdminShelfCounts
  paid: PackAdminShelfCounts
}

/** Short shelf label for badges and tabs (dev dad / ops wording). */
export function packAdminShelfBadgeLabel(productSlug: string | null | undefined): string {
  return isOwlCheckoutProductSlug(productSlug ?? '')
    ? '$OWL shelf'
    : 'Paid 0.1 SOL shelf'
}

/** Resolve product slug from inventory row + product list. */
export function packAdminShelfSlugForInventoryRow(
  row: { product_id?: string | null },
  products: PackAdminProductRef[]
): string {
  const id = row.product_id?.trim()
  if (id) {
    const match = products.find((p) => p.id === id)
    if (match?.slug) return match.slug
  }
  return PACKS_PRODUCT_SLUG_MAIN
}

export function packAdminInventoryMatchesShelfFilter(
  row: { product_id?: string | null },
  products: PackAdminProductRef[],
  filter: PackAdminInventoryShelfFilter
): boolean {
  if (filter === 'all') return true
  const slug = packAdminShelfSlugForInventoryRow(row, products)
  if (filter === 'owl') return isOwlCheckoutProductSlug(slug)
  return !isOwlCheckoutProductSlug(slug)
}

function isInventoryAvailable(status: string | null | undefined): boolean {
  return (status ?? 'available') === 'available'
}

function isInventoryOutOfPool(status: string | null | undefined): boolean {
  const s = (status ?? 'available') as PackInventoryStatus
  return s === 'paid' || s === 'reserved' || s === 'removed'
}

function countShelfRows(
  rows: { product_id?: string | null; status: string }[],
  products: PackAdminProductRef[],
  shelf: 'owl' | 'paid' | 'all'
): PackAdminShelfCounts {
  const filtered = rows.filter((row) => {
    if (shelf === 'all') return true
    const slug = packAdminShelfSlugForInventoryRow(row, products)
    if (shelf === 'owl') return isOwlCheckoutProductSlug(slug)
    return !isOwlCheckoutProductSlug(slug)
  })
  let available = 0
  let outOfPool = 0
  for (const row of filtered) {
    if (isInventoryAvailable(row.status)) available += 1
    else if (isInventoryOutOfPool(row.status)) outOfPool += 1
  }
  return { available, outOfPool, total: filtered.length }
}

export function packAdminInventoryShelfSummary(
  rows: { product_id?: string | null; status: string }[],
  products: PackAdminProductRef[]
): PackAdminInventoryShelfSummary {
  return {
    all: countShelfRows(rows, products, 'all'),
    owl: countShelfRows(rows, products, 'owl'),
    paid: countShelfRows(rows, products, 'paid'),
  }
}

export function packAdminInventoryStatusLabel(status: string | null | undefined): string {
  const s = (status ?? 'available') as PackInventoryStatus
  if (s === 'available') return 'Available'
  if (s === 'reserved') return 'Reserved (open in progress)'
  if (s === 'paid') return 'Won / paid out'
  if (s === 'removed') return 'Removed from shelf'
  return status ?? '—'
}

/** Tailwind classes for shelf badge (mobile-friendly, high contrast). */
export function packAdminShelfBadgeClassName(productSlug: string | null | undefined): string {
  return isOwlCheckoutProductSlug(productSlug ?? '')
    ? 'border-violet-500/40 bg-violet-500/15 text-violet-100'
    : 'border-sky-500/40 bg-sky-500/15 text-sky-100'
}
