export type OwlCenterPhase = 'AIRDROP' | 'PRESALE' | 'WHITELIST' | 'PUBLIC' | 'SOLD_OUT' | 'TRADING_ACTIVE'

export type OwlCenterStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'PRESALE'
  | 'WHITELIST'
  | 'PUBLIC'
  | 'SOLD_OUT'
  | 'TRADING_ACTIVE'

export type OwlCenterLaunchPublic = {
  id: string
  slug: string
  name: string
  symbol: string | null
  description: string | null
  image_url: string | null
  creator_wallet: string | null
  candy_machine_id: string | null
  collection_mint: string | null
  /** Devnet CM proof-of-mint — never replaces mainnet `candy_machine_id`. */
  devnet_candy_machine_id: string | null
  devnet_collection_mint: string | null
  mint_standard: string
  total_supply: number
  minted_count: number
  active_phase: OwlCenterPhase
  status: OwlCenterStatus
  presale_supply: number
  wl_supply: number
  public_supply: number
  airdrop_supply: number
  presale_price_usdc: number | null
  wl_price_usdc: number | null
  public_price_usdc: number | null
  wallet_mint_limit: number
  magic_eden_url: string | null
  tensor_url: string | null
  is_featured: boolean
  is_paused: boolean
  launch_deadline_at: string | null
  updated_at: string
  /** Asset + metadata package gates (Owl Center launchpad). */
  metadata_ready: boolean
  assets_ready: boolean
  marketplace_ready: boolean
  treasury_wallet: string | null
  creator_presale_enabled: boolean
  creator_wl_enabled: boolean
  creator_mint_price: number | null
  creator_mint_currency: string | null
  creator_launch_date: string | null
}

export type Gen2EligibilityResponse = {
  active_phase: OwlCenterPhase
  status: OwlCenterStatus
  is_paused: boolean
  is_eligible: boolean
  max_mintable: number
  reason: string | null
  presale_balance?: {
    purchased_mints: number
    gifted_mints: number
    used_mints: number
    available_mints: number
  }
  wl_allocation?: {
    allowed_mints: number
    used_mints: number
    available_mints: number
  }
  /** SOL lamports for paid phases (WL/PUBLIC); null during presale redemption (fees only). */
  unit_lamports_estimate: string | null
  sol_usd_price: number | null
  price_usdc: number | null
}

export type MintTerminalLine = {
  id: string
  kind: 'mint' | 'system'
  message: string
  created_at: string
}
