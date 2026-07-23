export type AuctionPrizeType = 'nft' | 'sol' | 'usdc'
export type AuctionBidCurrency = 'SOL' | 'USDC'
export type AuctionFeeTierReason = 'partner_community' | 'holder' | 'standard'

export type AuctionStatus =
  | 'draft'
  | 'live'
  | 'ended'
  | 'successful_pending_claims'
  | 'failed_reserve'
  | 'cancelled'
  | 'completed'

export type AuctionBidStatus =
  | 'pending_deposit'
  | 'active'
  | 'outbid'
  | 'won'
  | 'refunded'
  | 'expired'

export type NftAuction = {
  id: string
  slug: string
  title: string
  description: string | null
  image_url: string | null
  creator_wallet: string
  status: AuctionStatus
  prize_type: AuctionPrizeType
  nft_mint_address: string | null
  nft_token_id: string | null
  prize_standard: string | null
  prize_amount: number | null
  bid_currency: AuctionBidCurrency
  start_price: number
  reserve_price: number | null
  reserve_hidden: boolean
  starts_at: string
  ends_at: string
  original_ends_at: string
  soft_close_extensions: number
  current_bid_amount: number | null
  current_bid_id: string | null
  bid_count: number
  fee_bps_applied: number
  fee_tier_reason: AuctionFeeTierReason
  platform_fee_amount: number | null
  creator_payout_amount: number | null
  winner_wallet: string | null
  winning_bid_id: string | null
  prize_escrow_address_snapshot: string | null
  funds_escrow_address_snapshot: string | null
  prize_deposited_at: string | null
  prize_deposit_tx: string | null
  prize_claimed_at: string | null
  prize_claim_tx: string | null
  prize_claim_locked_at: string | null
  prize_claim_locked_wallet: string | null
  creator_claimed_at: string | null
  creator_claim_tx: string | null
  creator_claim_locked_at: string | null
  ended_at: string | null
  cancelled_at: string | null
  created_at: string
  updated_at: string
}

/** Public/partner client shape — never exposes raw reserve_price when hidden. */
export type NftAuctionPublic = Omit<NftAuction, 'reserve_price'> & {
  reserve_price: number | null
  reserve_met: boolean
  has_reserve: boolean
  min_next_bid: number
}

export type NftAuctionBid = {
  id: string
  auction_id: string
  bidder_wallet: string
  currency: AuctionBidCurrency
  amount: number
  status: AuctionBidStatus
  deposit_tx_signature: string | null
  created_at: string
  activated_at: string | null
  outbid_at: string | null
  refund_tx_signature: string | null
  refunded_at: string | null
}
