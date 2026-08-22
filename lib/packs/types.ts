import type { PackPrizeCategory } from '@/lib/packs/config'

export type PackOpenStatus =
  | 'pending_payment'
  | 'paid'
  | 'rolling'
  | 'reserved'
  | 'paying_out'
  | 'completed'
  | 'failed'
  | 'refund_needed'

export type PackInventoryStatus = 'available' | 'reserved' | 'paid' | 'removed'

export type PackProductRow = {
  id: string
  slug: string
  name: string
  price_sol: number
  rtp_bps: number
  category_owl_bps: number
  category_sol_bps: number
  category_nft_bps: number
  active: boolean
  created_at: string
  updated_at: string
}

export type PackVaultConfigRow = {
  id: number
  vault_pubkey: string | null
  paused: boolean
  pause_reason: string | null
  min_owl_balance: number
  min_sol_balance: number
  min_nft_count: number
  owl_sol_price: number | null
  updated_at: string
}

export type PackInventoryPrizeStandard = 'spl' | 'mpl_core' | 'compressed'

export const PACK_INVENTORY_PRIZE_STANDARDS: PackInventoryPrizeStandard[] = [
  'spl',
  'mpl_core',
  'compressed',
]

export function isPackInventoryPrizeStandard(
  value: unknown
): value is PackInventoryPrizeStandard {
  return (
    value === 'spl' || value === 'mpl_core' || value === 'compressed'
  )
}

export function packInventoryPrizeStandardLabel(
  standard: PackInventoryPrizeStandard | string | null | undefined
): string {
  if (standard === 'mpl_core') return 'Core'
  if (standard === 'compressed') return 'cNFT'
  return 'SPL'
}

export type PackInventoryRow = {
  id: string
  kind: 'nft'
  mint_address: string
  name: string | null
  image_url: string | null
  fair_value_sol: number
  prize_standard: PackInventoryPrizeStandard
  status: PackInventoryStatus
  reserved_open_id: string | null
  paid_open_id: string | null
  payout_signature: string | null
  created_at: string
  updated_at: string
}

export type PackOpenVrfStatus = 'pending' | 'failed' | 'fulfilled'

export type PackNftPoolSnapshotRow = {
  id: string
  mint: string
  fair_value_sol: number
  weight: number
}

export type PackOpenRow = {
  id: string
  product_id: string
  buyer_wallet: string
  payment_signature: string | null
  status: PackOpenStatus
  open_algo: string
  open_seed: string | null
  open_commit_hash: string | null
  category: PackPrizeCategory | null
  prize_label: string | null
  owl_amount: number | null
  sol_amount: number | null
  nft_inventory_id: string | null
  nft_mint_address: string | null
  fair_value_sol: number | null
  free_ticket_credits: number
  payout_signature: string | null
  error_message: string | null
  created_at: string
  completed_at: string | null
  open_vrf_provider?: string | null
  open_vrf_status?: PackOpenVrfStatus | null
  open_vrf_account?: string | null
  open_vrf_request_tx?: string | null
  open_vrf_fulfill_tx?: string | null
  open_vrf_error?: string | null
  nft_pool_snapshot?: PackNftPoolSnapshotRow[] | null
}

export type PackTicketCreditRow = {
  id: string
  wallet: string
  open_id: string
  credits_granted: number
  credits_remaining: number
  created_at: string
}

export type PackOpenResult = {
  openId: string
  category: PackPrizeCategory
  prizeLabel: string
  owlAmount: number | null
  solAmount: number | null
  nftMint: string | null
  nftName: string | null
  nftImageUrl: string | null
  fairValueSol: number
  freeTicketCredits: number
  payoutSignature: string | null
  openSeed: string
  openCommitHash: string
  openAlgo: string
}

export type WeightedTierPick =
  | { category: 'owl'; amount: number; fairValueSol: number; tierIndex: number }
  | { category: 'sol'; amountSol: number; fairValueSol: number; tierIndex: number }
  | {
      category: 'nft'
      bandIndex: number
      minFairValueSol: number
      maxFairValueSol: number
    }
