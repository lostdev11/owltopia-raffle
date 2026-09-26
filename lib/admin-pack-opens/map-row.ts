import type {
  AdminPackOpenDetailRow,
  AdminPackOpenListRow,
  AdminPackOpenProductSummary,
} from '@/lib/admin-pack-opens/types'
import type { PackOpenRow, PackOpenStatus } from '@/lib/packs/types'

type DbProductJoin = { id: string; slug: string; name: string; price_sol: number } | null

export type PackOpenAdminDbRow = PackOpenRow & {
  pack_products?: DbProductJoin | DbProductJoin[]
}

function normalizeProduct(raw: PackOpenAdminDbRow['pack_products']): AdminPackOpenProductSummary {
  const row = Array.isArray(raw) ? raw[0] : raw
  return {
    id: row?.id ?? '',
    slug: row?.slug?.trim() || 'unknown',
    name: row?.name?.trim() || 'Pack',
    price_sol: Number(row?.price_sol ?? 0),
  }
}

export function computePackOpenLastActivityAt(row: Pick<PackOpenRow, 'created_at' | 'completed_at'>): string {
  const created = Date.parse(row.created_at)
  const completed = row.completed_at ? Date.parse(row.completed_at) : NaN
  if (Number.isFinite(completed) && completed >= created) return row.completed_at as string
  return row.created_at
}

function formatPriceDisplay(row: PackOpenRow, product: AdminPackOpenProductSummary): string {
  if (row.payment_currency === 'OWL') {
    const owl = row.payment_owl_amount != null ? String(row.payment_owl_amount) : '—'
    const fee = row.payment_fee_sol != null ? String(row.payment_fee_sol) : '—'
    return `${owl} OWL + ${fee} SOL fee`
  }
  const sol = product.price_sol > 0 ? String(product.price_sol) : '—'
  return `${sol} SOL`
}

function buildPrizeSummary(row: PackOpenRow): string | null {
  if (row.status !== 'completed' && !row.prize_label && !row.category) return null
  const parts: string[] = []
  if (row.is_jackpot_win) parts.push('Jackpot')
  if (row.category) parts.push(row.category.toUpperCase())
  if (row.prize_label?.trim()) parts.push(row.prize_label.trim())
  else {
    if (row.owl_amount != null) parts.push(`${row.owl_amount} OWL`)
    if (row.sol_amount != null) parts.push(`${row.sol_amount} SOL`)
    if (row.nft_mint_address) parts.push(`NFT ${row.nft_mint_address.slice(0, 8)}…`)
  }
  return parts.length ? parts.join(' · ') : null
}

const LIST_SELECT_FIELDS = `
  id,
  product_id,
  buyer_wallet,
  payment_signature,
  payment_currency,
  payment_owl_amount,
  payment_fee_sol,
  status,
  category,
  prize_label,
  owl_amount,
  sol_amount,
  nft_mint_address,
  fair_value_sol,
  is_jackpot_win,
  payout_signature,
  error_message,
  created_at,
  completed_at,
  open_vrf_request_tx,
  open_vrf_fulfill_tx,
  open_vrf_error,
  open_algo,
  open_commit_hash,
  nft_inventory_id,
  free_ticket_credits,
  jackpot_contribution_sol,
  jackpot_amount_sol,
  open_vrf_provider,
  open_vrf_status,
  open_vrf_account,
  nft_pool_snapshot,
  pack_products ( id, slug, name, price_sol )
` as const

export function adminPackOpensListSelect(): string {
  return LIST_SELECT_FIELDS
}

export function mapPackOpenToAdminListRow(row: PackOpenAdminDbRow): AdminPackOpenListRow {
  const product = normalizeProduct(row.pack_products)
  return {
    id: row.id,
    created_at: row.created_at,
    last_activity_at: computePackOpenLastActivityAt(row),
    buyer_wallet: row.buyer_wallet,
    product,
    payment_currency: row.payment_currency,
    price_display: formatPriceDisplay(row, product),
    status: row.status as PackOpenStatus,
    payment_signature: row.payment_signature,
    payout_signature: row.payout_signature,
    open_vrf_request_tx: row.open_vrf_request_tx ?? null,
    open_vrf_fulfill_tx: row.open_vrf_fulfill_tx ?? null,
    prize_summary: buildPrizeSummary(row),
    error_message: row.error_message,
    open_vrf_error: row.open_vrf_error ?? null,
    completed_at: row.completed_at,
  }
}

export function mapPackOpenToAdminDetailRow(row: PackOpenAdminDbRow): AdminPackOpenDetailRow {
  const base = mapPackOpenToAdminListRow(row)
  const snapshot = row.nft_pool_snapshot
  return {
    ...base,
    open_algo: row.open_algo,
    open_commit_hash: row.open_commit_hash,
    category: row.category,
    prize_label: row.prize_label,
    owl_amount: row.owl_amount,
    sol_amount: row.sol_amount,
    nft_inventory_id: row.nft_inventory_id,
    nft_mint_address: row.nft_mint_address,
    fair_value_sol: row.fair_value_sol,
    free_ticket_credits: row.free_ticket_credits,
    payment_owl_amount: row.payment_owl_amount,
    payment_fee_sol: row.payment_fee_sol,
    is_jackpot_win: row.is_jackpot_win,
    jackpot_contribution_sol: row.jackpot_contribution_sol,
    jackpot_amount_sol: row.jackpot_amount_sol,
    open_vrf_provider: row.open_vrf_provider ?? null,
    open_vrf_status: row.open_vrf_status ?? null,
    open_vrf_account: row.open_vrf_account ?? null,
    nft_pool_snapshot_count: Array.isArray(snapshot) ? snapshot.length : snapshot ? 0 : null,
  }
}

/** Ensures open_seed never appears in admin API payloads. */
export function assertNoPackOpenSecrets(row: Record<string, unknown>): void {
  if ('open_seed' in row) {
    throw new Error('open_seed must not be exposed in admin pack opens API')
  }
}
