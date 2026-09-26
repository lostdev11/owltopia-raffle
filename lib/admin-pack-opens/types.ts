import type { PackPrizeCategory } from '@/lib/packs/config'
import type { PackOpenStatus, PackOpenVrfStatus } from '@/lib/packs/types'

export type AdminPackOpenProductSummary = {
  id: string
  slug: string
  name: string
  price_sol: number
}

export type AdminPackOpenListRow = {
  id: string
  created_at: string
  /** Best-effort activity time (no pack_opens.updated_at column). */
  last_activity_at: string
  buyer_wallet: string
  product: AdminPackOpenProductSummary
  payment_currency: 'SOL' | 'OWL'
  price_display: string
  status: PackOpenStatus
  payment_signature: string | null
  payout_signature: string | null
  open_vrf_request_tx: string | null
  open_vrf_fulfill_tx: string | null
  prize_summary: string | null
  error_message: string | null
  open_vrf_error: string | null
  completed_at: string | null
}

export type AdminPackOpenDetailRow = AdminPackOpenListRow & {
  open_algo: string
  open_commit_hash: string | null
  category: PackPrizeCategory | null
  prize_label: string | null
  owl_amount: number | null
  sol_amount: number | null
  nft_inventory_id: string | null
  nft_mint_address: string | null
  fair_value_sol: number | null
  free_ticket_credits: number
  payment_owl_amount: number | null
  payment_fee_sol: number | null
  is_jackpot_win: boolean
  jackpot_contribution_sol: number | null
  jackpot_amount_sol: number | null
  open_vrf_provider: string | null
  open_vrf_status: PackOpenVrfStatus | null
  open_vrf_account: string | null
  nft_pool_snapshot_count: number | null
}

export type ListAdminPackOpensParams = {
  wallet?: string
  walletMode: 'exact' | 'prefix'
  statuses?: PackOpenStatus[]
  productId?: string
  createdFrom?: string
  createdTo?: string
  stuckAttention?: boolean
  stuckMinutes?: number
  limit: number
  offset: number
}

export type PackOpensListFilterPlan = {
  wallet?: { mode: 'exact' | 'prefix'; value: string }
  statuses?: PackOpenStatus[]
  productId?: string
  createdFrom?: string
  createdTo?: string
  stuckAttention?: { cutoffIso: string; pipelineStatuses: PackOpenStatus[] }
}
