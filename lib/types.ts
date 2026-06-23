/** Allowed raffle card / detail accent colors (stored as `theme_accent`). */
export const THEME_ACCENT_VALUES = [
  'prime',
  'midnight',
  'dawn',
  'ember',
  'violet',
  'coral',
  'gold',
  'sky',
  'mint',
  'indigo',
  'fuchsia',
] as const

export type ThemeAccent = (typeof THEME_ACCENT_VALUES)[number]

export type EntryStatus = 'pending' | 'confirmed' | 'rejected'

export type PrizeType = 'crypto' | 'nft'

/** How the NFT prize is represented on-chain (used for escrow logic). */
export type PrizeStandard = 'spl' | 'token2022' | 'mpl_core' | 'compressed'

export type CommunityGiveawayAccessGate = 'open' | 'holder_only'

export type CommunityGiveawayStatus = 'draft' | 'open' | 'drawn' | 'cancelled'

/** Pool giveaway: users join; optional holder gate; OWL boost before starts_at; admin draws winner; NFT claim from escrow. */
export interface CommunityGiveaway {
  id: string
  title: string
  description: string | null
  access_gate: CommunityGiveawayAccessGate
  status: CommunityGiveawayStatus
  /** OWL boost only allowed while server time is strictly before this instant. */
  starts_at: string
  /** When set, joins are rejected after this instant (admin may still draw). */
  ends_at: string | null
  nft_mint_address: string
  nft_token_id: string | null
  prize_standard: PrizeStandard | null
  deposit_tx_signature: string | null
  prize_deposited_at: string | null
  winner_wallet: string | null
  winner_selected_at: string | null
  claim_tx_signature: string | null
  claimed_at: string | null
  nft_claim_locked_at: string | null
  nft_claim_locked_wallet: string | null
  created_by_wallet: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface CommunityGiveawayEntry {
  id: string
  giveaway_id: string
  wallet_address: string
  draw_weight: number
  created_at: string
}

/** Admin-created giveaway: NFT in prize escrow, one eligible claimant. */
export interface NftGiveaway {
  id: string
  title: string | null
  nft_mint_address: string
  nft_token_id: string | null
  prize_standard: PrizeStandard | null
  eligible_wallet: string
  deposit_tx_signature: string | null
  prize_deposited_at: string | null
  claim_tx_signature: string | null
  claimed_at: string | null
  nft_claim_locked_at: string | null
  nft_claim_locked_wallet: string | null
  created_by_wallet: string | null
  notes: string | null
  /** Optional paid Discord partner: we post to their channel webhook on verify/claim. */
  discord_partner_tenant_id: string | null
  created_at: string
  updated_at: string
}

/** External Discord server using our giveaway webhook / API (billing: active_until + status). */
export type DiscordGiveawayPartnerStatus = 'active' | 'trial' | 'suspended'

export interface DiscordGiveawayPartnerTenant {
  id: string
  name: string
  discord_guild_id: string | null
  /** Null until the server owner runs /owltopia-partner webhook (slash). */
  webhook_url: string | null
  /**
   * Optional. Same idea as `DISCORD_WEBHOOK_RAFFLE_*` for Owltopia: announce new ticket raffles
   * hosted by a partner-linked creator, in this Discord.
   */
  raffle_webhook_url_created: string | null
  /** Optional. Winner-draw pings (claims happen on the Owltopia user dashboard). */
  raffle_webhook_url_winner: string | null
  api_secret_hash: string
  status: DiscordGiveawayPartnerStatus
  active_until: string | null
  contact_note: string | null
  created_by_wallet: string | null
  created_at: string
  updated_at: string
}

export type RaffleStatus =
  | 'draft'
  | 'live'
  | 'ready_to_draw'
  | 'completed'
  | 'cancelled'
  | 'pending_min_not_met'
  | 'successful_pending_claims'
  | 'failed_refund_available'
  | null

/** Supported raffle ticket currencies */
export type RaffleCurrency = 'SOL' | 'USDC' | 'OWL' | 'BAMBOO'

export type RaffleOfferStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'

export type RaffleMilestoneTriggerType = 'percent_max' | 'absolute_tickets' | 'draw_threshold'

export type RaffleMilestoneWinnerMode = 'random' | 'top_buyer' | 'creator_initiated_pull'

export type RaffleMilestoneWinnerSelectionMode =
  | 'creator_triggered_random'
  | 'auto_random'
  | 'auto_top_buyer'

export type RaffleMilestoneStatus =
  | 'pending'
  | 'unlocked'
  | 'awarded'
  | 'claimed'
  | 'returned'
  | 'void'

export type RaffleMilestonePrizeType = 'crypto' | 'nft'

/** Prefunded side prize unlocked by ticket sales; pays only when raffle draw threshold succeeds. */
export interface RaffleMilestone {
  id: string
  raffle_id: string
  sort_order: number
  trigger_type: RaffleMilestoneTriggerType
  trigger_value: number
  prize_type: RaffleMilestonePrizeType
  prize_amount: number | null
  prize_currency: 'SOL' | 'USDC' | null
  nft_mint_address: string | null
  nft_token_id: string | null
  winner_mode: RaffleMilestoneWinnerMode
  status: RaffleMilestoneStatus
  unlocked_at: string | null
  winner_wallet: string | null
  winner_selected_at: string | null
  winner_selection_mode: RaffleMilestoneWinnerSelectionMode | null
  deposit_tx: string | null
  deposit_verified_at: string | null
  claim_tx: string | null
  claimed_at: string | null
  returned_at: string | null
  return_tx: string | null
  created_at: string
  updated_at: string
}

/** Client payload when configuring milestones at create time (before DB ids exist). */
export type RaffleMilestoneCreateInput = {
  trigger_type: RaffleMilestoneTriggerType
  trigger_value: number
  prize_type: RaffleMilestonePrizeType
  prize_amount?: number | null
  prize_currency?: 'SOL' | 'USDC' | null
  nft_mint_address?: string | null
  nft_token_id?: string | null
  winner_mode: RaffleMilestoneWinnerMode
}

/** Mint count threshold (`absolute_mints`) or % of total supply (`percent_supply`). */
export type Gen2MintMilestoneTriggerType = 'absolute_mints' | 'percent_supply'

/** A random minter (weighted by mints) or the top minter wins. */
export type Gen2MintMilestoneWinnerMode = 'random' | 'top_buyer'

export type Gen2MintMilestoneWinnerSelectionMode = 'auto_random' | 'auto_top_buyer'

export type Gen2MintMilestoneStatus =
  | 'pending'
  | 'unlocked'
  | 'awarded'
  | 'claimed'
  | 'returned'
  | 'void'

export type Gen2MintMilestonePrizeType = 'crypto' | 'nft'

/** Prefunded side prize on an Owl Center launch, unlocked when mint count crosses a threshold. */
export interface Gen2MintMilestone {
  id: string
  launch_id: string
  sort_order: number
  trigger_type: Gen2MintMilestoneTriggerType
  trigger_value: number
  prize_type: Gen2MintMilestonePrizeType
  prize_amount: number | null
  prize_currency: 'SOL' | 'USDC' | null
  nft_mint_address: string | null
  nft_token_id: string | null
  winner_mode: Gen2MintMilestoneWinnerMode
  status: Gen2MintMilestoneStatus
  trigger_mint_target: number | null
  unlocked_at: string | null
  unlocked_at_minted_count: number | null
  winner_wallet: string | null
  winner_selected_at: string | null
  winner_selection_mode: Gen2MintMilestoneWinnerSelectionMode | null
  funded_by_wallet: string | null
  deposit_tx: string | null
  deposit_verified_at: string | null
  claim_tx: string | null
  claimed_at: string | null
  returned_at: string | null
  return_tx: string | null
  created_at: string
  updated_at: string
}

/** Input when an admin/creator adds a single mint milestone (pre-launch or mid-mint). */
export type Gen2MintMilestoneCreateInput = {
  trigger_type: Gen2MintMilestoneTriggerType
  trigger_value: number
  prize_amount: number
  prize_currency: 'SOL' | 'USDC'
  winner_mode: Gen2MintMilestoneWinnerMode
}

export interface Raffle {
  id: string
  slug: string
  title: string
  description: string | null
  image_url: string | null
  /** Full-admin fallback when primary listing art fails to load or is missing (HTTPS / IPFS / site paths). */
  image_fallback_url: string | null
  prize_type: PrizeType
  prize_amount: number | null
  prize_currency: string | null
  nft_mint_address: string | null
  nft_collection_name: string | null
  /** Optional X handle (no @) for official Owltopia share copy — e.g. THC_Labz. */
  promo_x_handle: string | null
  nft_token_id: string | null
  nft_metadata_uri: string | null
  ticket_price: number
  currency: RaffleCurrency
  /**
   * Optional second ticket asset paired with {@link currency} — only SOL↔BAMBOO (see migration 114).
   * When set, {@link alternate_ticket_price} is the per-ticket price in this asset.
   */
  alternate_ticket_currency: RaffleCurrency | null
  /** Per-ticket price in `alternate_ticket_currency` (null when single-currency tickets). */
  alternate_ticket_price: number | null
  max_tickets: number | null
  min_tickets: number | null
  start_time: string
  end_time: string
  original_end_time: string | null
  /** How many times end_time was extended because min_tickets was not met at deadline (max 1 before terminal). */
  time_extension_count: number
  theme_accent: ThemeAccent
  edited_after_entries: boolean
  created_at: string
  updated_at: string
  created_by: string | null
  is_active: boolean
  winner_wallet: string | null
  winner_selected_at: string | null
  status: RaffleStatus
  nft_transfer_transaction: string | null
  // Short-lived server-side lock to prevent concurrent winner-claim
  // requests from both trying to transfer the escrowed NFT.
  nft_claim_locked_at?: string | null
  nft_claim_locked_wallet?: string | null
  // V1 fee settlement fields (creator-based platform fee)
  creator_wallet: string | null
  fee_bps_applied: number | null
  fee_tier_reason: string | null
  platform_fee_amount: number | null
  creator_payout_amount: number | null
  settled_at: string | null
  rank: string | null
  floor_price: string | null
  /** Set when NFT prize was verified in platform escrow (prize escrow flow). */
  prize_deposited_at: string | null
  /** Tx signature when creator deposited NFT to escrow. Used to identify mint when escrow holds multiple NFTs. */
  prize_deposit_tx: string | null
  /** Set when prize was returned from escrow to creator (admin, terminal min-threshold flow, or creator retry). */
  prize_returned_at: string | null
  /** Reason for return (includes min_threshold_not_met after terminal extension exhaustion). */
  prize_return_reason: string | null
  /** Solana tx signature for the return transfer to creator. */
  prize_return_tx: string | null
  /** Enriched at list time: true if creator is an Owltopia (Owl NFT) holder. Used for card badge. */
  creator_is_holder?: boolean
  /** Enriched at list time: creator wallet is in partner_community_creators (2% fee, spotlight). */
  creator_is_partner?: boolean
  /**
   * Enriched at list time for partner creators: `wallet_profiles.display_name` when set, else optional
   * `partner_community_creators.display_label`. Used for partner badge copy / accessibility.
   */
  creator_partner_display_name?: string | null
  /**
   * Enriched at list time: `partner_community_creators.display_label` when set (admin partner brand name).
   * Used for partner spotlight logo matching — profile display names often omit the brand keyword.
   */
  creator_partner_table_label?: string | null
  /**
   * Enriched server-side: when true, description may render https URLs as clickable links.
   * Only set for raffles whose creator is in the admins table — reduces phishing from non-admin listings.
   */
  description_urls_clickable?: boolean
  /**
   * When the creator wallet is allowlisted in `partner_community_creators` with a linked
   * `discord_partner_tenant_id`, the raffle is stamped for partner Discord webhooks.
   */
  discord_partner_tenant_id: string | null
  /**
   * When true (default), the raffle is included in the public /raffles list and list APIs.
   * When false, it is for partner Discord / direct link only: still at `/raffles/{slug}` for entry.
   */
  list_on_platform: boolean
  /**
   * When true, raffle is shown only under the ".sol domains" hub tab (`?tab=sol-domains`), not Main or Partner.
   * NFT raffles only; use `floor_price` for the listed reference value (no automated SNS/market calls).
   */
  sol_domains_hub: boolean
  /** When creator requested cancellation (pending admin approval). */
  cancellation_requested_at: string | null
  /** When admin accepted cancellation. */
  cancelled_at: string | null
  /** Cancellation fee amount (when refund policy is no_refund). */
  cancellation_fee_amount: number | null
  /** Currency of cancellation fee (e.g. SOL, USDC). */
  cancellation_fee_currency: string | null
  /**
   * full_refund = no post-start cancellation fee paid by host; no_refund = host paid the post-start fee
   * (recorded on admin accept). Ticket buyers can still get refunds in both cases when treasury processes them.
   */
  cancellation_refund_policy: 'full_refund' | 'no_refund' | null
  /** Set when the creator’s on-chain cancellation-fee transfer was verified (post-start raffles). */
  cancellation_fee_paid_at: string | null
  /** Solana signature of the cancellation-fee transfer. */
  cancellation_fee_payment_tx: string | null
  /** On-chain standard for NFT prize (SPL / Token-2022 / Mpl Core). Defaults to 'spl' when null. */
  prize_standard?: PrizeStandard | null
  /** When admin blocked ticket purchases (e.g. NFT not in escrow). Null = purchases allowed. */
  purchases_blocked_at?: string | null
  /** Host was on admin moderation list at create — show buyer caution on listing. */
  creator_restricted_listing?: boolean
  /** Lamports required before go-live for restricted creators (snapshot at create). */
  moderation_listing_fee_lamports?: number | null
  moderation_listing_fee_paid_at?: string | null
  moderation_listing_fee_payment_tx?: string | null
  /** When true, ticket gross is paid to funds escrow; creator claims net after draw. */
  ticket_payments_to_funds_escrow?: boolean | null
  /** Prize escrow pubkey at creation (verification / support). */
  nft_escrow_address_snapshot?: string | null
  /** Funds escrow pubkey at creation. */
  funds_escrow_address_snapshot?: string | null
  /** Creator claimed net proceeds from funds escrow. */
  creator_claimed_at?: string | null
  creator_claim_tx?: string | null
  creator_funds_claim_locked_at?: string | null
  /** Set when a buyout offer was accepted; no further bids allowed. */
  buyout_closed_at?: string | null
}

/** Post-draw buyout bid on an NFT prize (v1: no pre-bids). */
export type RaffleBuyoutOfferStatus =
  | 'pending_deposit'
  | 'active'
  | 'accepted'
  | 'expired'
  | 'refunded'
  | 'superseded'

export interface RaffleBuyoutOffer {
  id: string
  raffle_id: string
  bidder_wallet: string
  currency: 'SOL' | 'USDC'
  amount: number
  status: RaffleBuyoutOfferStatus
  deposit_tx_signature: string | null
  created_at: string
  activated_at: string | null
  expires_at: string | null
  accepted_at: string | null
  accepted_by_wallet: string | null
  treasury_fee_bps: number
  treasury_fee_amount: number | null
  winner_net_amount: number | null
  payout_tx_signature: string | null
  refund_tx_signature: string | null
  refunded_at: string | null
}

export interface RaffleOffer {
  id: string
  raffle_id: string
  buyer_wallet: string
  amount: number
  currency: RaffleCurrency
  status: RaffleOfferStatus
  created_at: string
  updated_at: string
  expires_at: string
  accepted_at: string | null
  accepted_by_wallet: string | null
  treasury_fee_bps: number
  treasury_fee_amount: number | null
  winner_net_amount: number | null
  funded_at: string
  refunded_at: string | null
  refund_tx_signature: string | null
}

export interface Entry {
  id: string
  raffle_id: string
  wallet_address: string
  ticket_quantity: number
  transaction_signature: string | null
  status: EntryStatus
  amount_paid: number
  currency: RaffleCurrency
  created_at: string
  verified_at: string | null
  restored_at: string | null
  restored_by: string | null
  refunded_at?: string | null
  refund_transaction_signature?: string | null
  refund_lock_started_at?: string | null
  /** Owltopia referral attribution (active code at purchase time). */
  referrer_wallet?: string | null
  referral_code_used?: string | null
  /** Promotional free ticket via referral (amount_paid 0); confirm with token RPC. */
  referral_complimentary?: boolean
  complimentary_confirm_token?: string | null
  complimentary_token_expires_at?: string | null
  /** Referral growth reward audit (complimentary redemption). */
  reward_mode_at_issue?: string | null
  reward_issued_at?: string | null
  reward_confirmed_at?: string | null
  reward_status?: string | null
  referral_reward_id?: string | null
}

export interface OwlVisionScore {
  score: number
  verifiedRatio: number
  diversityRatio: number
  integrityScore: number
  totalEntries: number
  confirmedEntries: number
  uniqueWallets: number
  editedAfterEntries: boolean
}

export interface RaffleWithStats extends Raffle {
  total_entries: number
  confirmed_entries: number
  unique_wallets: number
  owl_vision_score: number
}
