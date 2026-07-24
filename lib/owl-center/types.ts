import type { Gen2ClusterPresaleSummary } from '@/lib/gen2-presale/cluster-balance'
import type { OwlCenterMintControls } from '@/lib/owl-center/mint-policy'
import type { PresaleMintPoolSnapshot } from '@/lib/owl-center/presale-mint-pool'
import type { WalletSplit } from '@/lib/owl-center/wallet-splits'

export type { Gen2ClusterPresaleSummary }

export type OwlCenterPhase =
  | 'AIRDROP'
  | 'PRESALE'
  | 'PRESALE_OVERAGE'
  | 'WHITELIST'
  | 'PUBLIC'
  | 'SOLD_OUT'
  | 'TRADING_ACTIVE'

export type OwlCenterStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'PRESALE'
  | 'WHITELIST'
  | 'PUBLIC'
  | 'SOLD_OUT'
  | 'TRADING_ACTIVE'

/** gen2_full = Owltopia Gen2 phased mint; public_simple = PUBLIC-only partner/demo collections. */
export type OwlCenterMintMode = 'gen2_full' | 'public_simple'

/** standard = final art at mint; reveal_day = placeholder mint until scheduled bulk reveal. */
export type OwlCenterRevealMode = 'standard' | 'reveal_day'

export type OwlCenterRevealStatus =
  | 'disabled'
  | 'draft'
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'

export type OwlCenterRevealProgress = {
  last_run_at?: string
  refreshed_count?: number
  skipped_count?: number
  error?: string
  attempts?: number
}

/** Metaplex Core mint standard for Owl Center launches. */
export type OwlCenterMintStandard = 'token_metadata' | 'core'

export type OwlCenterFreezeStatus =
  | 'disabled'
  | 'pending'
  | 'frozen'
  | 'thawing'
  | 'thawed'
  | 'failed'

export type OwlCenterFreezeProgress = {
  last_run_at?: string
  thawed_count?: number
  remaining_count?: number
  error?: string
  attempts?: number
  /** DAS asset count when thaw started. */
  total?: number
  /** Next DAS list offset for batched thaw. */
  offset?: number
  started_at?: string
  updated_at?: string
  unlocked_at?: string
  last_signature?: string
  /** On-chain freeze escrow `frozenCount` (source of truth for unlock). */
  frozen_count?: number
  /** Admin team backstop mint after public pool exhausts. */
  backstop_mint_enabled?: boolean
  backstop_team_wallets?: string[]
  backstop_enabled_at?: string
}

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
  /** Extra phases live concurrently with active_phase (empty = legacy single-phase behavior). */
  active_phases: OwlCenterPhase[]
  status: OwlCenterStatus
  presale_supply: number
  wl_supply: number
  public_supply: number
  airdrop_supply: number
  presale_overage_supply: number
  presale_price_usdc: number | null
  wl_price_usdc: number | null
  public_price_usdc: number | null
  wallet_mint_limit: number
  magic_eden_url: string | null
  tensor_url: string | null
  is_featured: boolean
  is_paused: boolean
  launch_deadline_at: string | null
  /** Optional ISO start time per mint phase (AIRDROP, PRESALE, …). */
  phase_schedule: Partial<Record<OwlCenterPhase, string>>
  updated_at: string
  /** Asset + metadata package gates (Owl Center launchpad). */
  metadata_ready: boolean
  assets_ready: boolean
  marketplace_ready: boolean
  treasury_wallet: string | null
  /** Secondary royalty recipients (share % must sum to 100). Locked after CM deploy. */
  royalty_splits: WalletSplit[] | null
  /** Mint proceeds recipients (share % must sum to 100). */
  mint_fund_splits: WalletSplit[] | null
  creator_presale_enabled: boolean
  creator_wl_enabled: boolean
  creator_mint_price: number | null
  creator_mint_currency: string | null
  creator_launch_date: string | null
  mint_mode: OwlCenterMintMode
  /** devnet | mainnet — when set, overrides site-wide devnet flag for this launch. */
  mint_network: 'devnet' | 'mainnet' | null
  /** Linked Owl Generator project id (Gen2 / admin export-and-stage). */
  generator_project_id: string | null
  /** Secondary sale royalty in basis points (500 = 5%). Locked after CM deploy. */
  seller_fee_basis_points: number
  /** null | standard = revealed at mint; reveal_day = blind mint until reveal_at. */
  reveal_mode: OwlCenterRevealMode | null
  reveal_status: OwlCenterRevealStatus
  reveal_at: string | null
  reveal_completed_at: string | null
  reveal_payment_tx_signature: string | null
  placeholder_metadata_uri: string | null
  reveal_progress: OwlCenterRevealProgress
  /** Metaplex Core "Freeze Collection" — minted assets are frozen until creator thaws (Core only). */
  freeze_enabled: boolean
  /** Optional date after which assets become eligible to thaw (also thaws on sellout). */
  unfreeze_date: string | null
  freeze_status: OwlCenterFreezeStatus
  /** Delegate pubkey holding the FreezeDelegate authority for the collection. */
  freeze_authority: string | null
  freeze_thawed_at: string | null
  freeze_progress: OwlCenterFreezeProgress
}

export type SimpleMintEligibilityResponse = {
  active_phase: OwlCenterPhase
  status: OwlCenterStatus
  is_paused: boolean
  is_eligible: boolean
  max_mintable: number
  reason: string | null
  wallet_minted: number
  wallet_mint_limit: number
  unit_lamports_estimate: string | null
  sol_usd_price: number | null
  price_usdc: number | null
  /** Owltopia platform fee per mint (USD notional; collected as SOL on-chain). */
  platform_mint_fee_usdc: number
  /** Live lamports quote for platform fee (SOL/USD). */
  platform_mint_fee_lamports_estimate: string | null
  /** Connected wallet SOL balance (lamports) when wallet is provided. */
  wallet_sol_balance_lamports: string | null
  /** Platform fee + rent reserve for one mint (lamports), when fee is enabled. */
  mint_sol_needed_lamports: string | null
  /** Human-readable platform fee label for mint UI. */
  platform_mint_fee_label: string
  /** Receives platform mint fee (OWL_PLATFORM_FEE_TREASURY_WALLET). */
  platform_treasury_wallet: string | null
  mint_network: 'devnet' | 'mainnet'
  mint_operational: boolean
}

export type CollectionMintStateResponse = {
  launch: OwlCenterLaunchPublic
  /** Recorded NFT mint addresses from confirm-mint / mint events. */
  minted_mints: string[]
  mint_controls: OwlCenterMintControls
  marketplace: {
    trading_links_active: boolean
    magic_eden_url: string | null
    tensor_url: string | null
    hash_list_ready: boolean
    sellout_prepared_at: string | null
    mint_addresses_recorded: number
  }
  supply: { total: number; minted: number; remaining: number; percent_minted: number }
  prices_usdc: { public: number | null }
  prices_lamports: { public: string | null }
  mint_network: 'devnet' | 'mainnet'
  presale_pool?: PresaleMintPoolSnapshot | null
  terminal: MintTerminalLine[]
}

export type Gen2PresaleBalanceSlice = {
  purchased_mints: number
  gifted_mints: number
  used_mints: number
  available_mints: number
  /** Paid presale spots still redeemable (excludes gift-only balance). */
  purchased_available_mints?: number
  is_paid_participant?: boolean
  /** Admin wallet switch: minting presale credits on behalf of this source wallet. */
  delegated_from?: string | null
  /** Admin wallet switch: presale credits delegated to this wallet. */
  delegated_away_to?: string | null
}

export type Gen2EligibilityResponse = {
  active_phase: OwlCenterPhase
  status: OwlCenterStatus
  is_paused: boolean
  is_eligible: boolean
  max_mintable: number
  reason: string | null
  presale_balance?: Gen2PresaleBalanceSlice
  wl_allocation?: {
    allowed_mints: number
    used_mints: number
    available_mints: number
    community?: string | null
  }
  gen1_snapshot?: {
    is_holder: boolean
    gen1_nft_count: number
    collection_configured?: boolean
    holder_check_available?: boolean
    /** Admin wallet switch: minting on behalf of this source wallet. */
    delegated_from?: string | null
    /** Admin wallet switch: this wallet handed its Gen1 mint to another wallet. */
    delegated_away_to?: string | null
  }
  /** SOL lamports for paid phases (WL/PUBLIC); null during presale redemption (fees only). */
  unit_lamports_estimate: string | null
  sol_usd_price: number | null
  price_usdc: number | null
  /** Scheduled open time for the active phase (if configured). */
  phase_starts_at?: string | null
  /** Owltopia platform fee per mint (USD notional; collected as SOL on-chain). */
  platform_mint_fee_usdc?: number
  /** Live lamports quote for the platform fee (SOL/USD); null when fee disabled or unpriced. */
  platform_mint_fee_lamports_estimate?: string | null
  /** Human-readable platform fee label for the mint UI. */
  platform_mint_fee_label?: string
  /** Connected wallet SOL balance (lamports) when a wallet is provided. */
  wallet_sol_balance_lamports?: string | null
  /** Platform fee + rent reserve for one mint (lamports), when the fee is enabled. */
  mint_sol_needed_lamports?: string | null
  /** Treasury that receives the platform fee; null when not configured. */
  platform_treasury_wallet?: string | null
}

export type Gen2MintCheckPhasePreview = {
  phase: OwlCenterPhase
  label: string
  price_usdc: number | null
  /** Live SOL quote (lamports string) for paid phases. */
  unit_lamports_estimate: string | null
  phase_supply: number
  /** NFTs minted in this phase across all wallets — drives the per-phase progress bar. */
  phase_minted: number
  /** When set, overrides `phase_supply - phase_minted` for the progress bar (PUBLIC shared pool). */
  phase_remaining?: number
  /**
   * Allocations still empty in this phase’s ledger, but no longer mintable as collection
   * inventory (e.g. Gen1/presale leftover after the Candy Machine sold out).
   */
  phase_unclaimed?: number
  is_active: boolean
  is_eligible: boolean
  max_mintable: number
  reason: string | null
  /** Spots reserved for this wallet when the phase opens (may differ from max_mintable during an active phase). */
  reserved_mints: number
  /** Informational when the phase is not currently active but the wallet still has allocation. */
  phase_note: string | null
  /** Scheduled open time for this phase (if configured). */
  phase_starts_at?: string | null
  /**
   * When this phase's open window closes (ISO), for phases with a finite window (e.g. WHITELIST's
   * 48h). Computed as `phase_starts_at + window`. Null for open-ended phases (PUBLIC) or when no
   * start time is configured. Drives the WL countdown timer in the mint UI.
   */
  window_ends_at?: string | null
  /** NFTs this wallet has already minted in this phase (recorded mint events). */
  minted_in_phase: number
  gen1?: {
    is_holder: boolean
    gen1_nft_count: number
    minted_in_phase: number
    cluster_gen1_nft_count?: number
    gen1_on_linked_wallet?: boolean
    /** Admin wallet switch: minting on behalf of this source wallet. */
    delegated_from?: string | null
    /** Admin wallet switch: this wallet handed its Gen1 mint to another wallet. */
    delegated_away_to?: string | null
  }
  presale?: Gen2PresaleBalanceSlice & {
    mint_cap?: number
    credits_issued?: number
    credits_overshoot?: number
  }
  wl?: {
    allowed_mints: number
    used_mints: number
    available_mints: number
    community: string | null
    discord_whitelist: boolean
    /** True when admin assigned spots in owl_center_wl_allocations (FCFS global pool at mint time). */
    admin_allocated: boolean
    cluster_available_mints?: number
    wl_on_linked_wallet?: boolean
  }
}

export type Gen2MintCheckResponse = {
  wallet: string | null
  active_phase: OwlCenterPhase
  status: OwlCenterStatus
  is_paused: boolean
  /** False until Candy Machine is configured and mint is not paused/kill-switched. */
  mint_operational?: boolean
  /** True when the global GEN1 / AIRDROP cap is fully minted (informational — later phases never wait for it). */
  airdrop_phase_complete?: boolean
  presale_purchases_closed: boolean
  /** True when all presale purchase spots are claimed (distinct from admin pause). */
  presale_sold_out: boolean
  presale_pool: {
    mint_cap: number
    credits_issued: number
    credits_overshoot: number
    presale_mints_recorded: number
    presale_mints_remaining: number
    overage_supply: number
    overage_mints_recorded: number
    overage_mints_remaining: number
  }
  wallet_cluster?: Gen2ClusterPresaleSummary
  phases: Gen2MintCheckPhasePreview[]
  current: Gen2EligibilityResponse
}

export type MintTerminalLine = {
  id: string
  kind: 'mint' | 'system'
  message: string
  created_at: string
}
