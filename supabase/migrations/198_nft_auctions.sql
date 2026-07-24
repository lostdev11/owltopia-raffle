-- ============================================================================
-- 198: Partner-gated NFT / SOL / USDC auctions (English auction + reserve).
-- Listing + browse: active partners and site admins. Bidding: same audience in v1.
-- Fees: raffle creator tiers (2% / 3% / 6%) on winning bid at settlement claim.
-- Prize in prize escrow; live high bid in funds escrow; claims for prize / proceeds / refunds.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.nft_auctions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,

  creator_wallet TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (
    status IN (
      'draft',
      'live',
      'ended',
      'successful_pending_claims',
      'failed_reserve',
      'cancelled',
      'completed'
    )
  ),

  prize_type TEXT NOT NULL CHECK (prize_type IN ('nft', 'sol', 'usdc')),
  nft_mint_address TEXT,
  nft_token_id TEXT,
  prize_standard TEXT,
  prize_amount NUMERIC,
  bid_currency TEXT NOT NULL CHECK (bid_currency IN ('SOL', 'USDC')),

  start_price NUMERIC NOT NULL CHECK (start_price > 0),
  reserve_price NUMERIC CHECK (reserve_price IS NULL OR reserve_price >= start_price),
  reserve_hidden BOOLEAN NOT NULL DEFAULT TRUE,

  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ NOT NULL,
  original_ends_at TIMESTAMPTZ NOT NULL,
  soft_close_extensions INT NOT NULL DEFAULT 0,

  current_bid_amount NUMERIC,
  current_bid_id UUID,
  bid_count INT NOT NULL DEFAULT 0,

  fee_bps_applied INT NOT NULL,
  fee_tier_reason TEXT NOT NULL CHECK (
    fee_tier_reason IN ('partner_community', 'holder', 'standard')
  ),
  platform_fee_amount NUMERIC,
  creator_payout_amount NUMERIC,

  winner_wallet TEXT,
  winning_bid_id UUID,

  prize_escrow_address_snapshot TEXT,
  funds_escrow_address_snapshot TEXT,
  prize_deposited_at TIMESTAMPTZ,
  prize_deposit_tx TEXT,
  prize_claimed_at TIMESTAMPTZ,
  prize_claim_tx TEXT,
  prize_claim_locked_at TIMESTAMPTZ,
  prize_claim_locked_wallet TEXT,
  creator_claimed_at TIMESTAMPTZ,
  creator_claim_tx TEXT,
  creator_claim_locked_at TIMESTAMPTZ,

  ended_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT nft_auctions_nft_fields_chk CHECK (
    (prize_type = 'nft' AND nft_mint_address IS NOT NULL AND prize_amount IS NULL)
    OR (prize_type IN ('sol', 'usdc') AND prize_amount IS NOT NULL AND prize_amount > 0 AND nft_mint_address IS NULL)
  ),
  CONSTRAINT nft_auctions_bid_currency_prize_chk CHECK (
    (prize_type = 'nft')
    OR (prize_type = 'sol' AND bid_currency = 'SOL')
    OR (prize_type = 'usdc' AND bid_currency = 'USDC')
  )
);

CREATE INDEX IF NOT EXISTS nft_auctions_status_ends_at_idx
  ON public.nft_auctions (status, ends_at);
CREATE INDEX IF NOT EXISTS nft_auctions_creator_wallet_idx
  ON public.nft_auctions (creator_wallet);
CREATE INDEX IF NOT EXISTS nft_auctions_status_creator_idx
  ON public.nft_auctions (status, creator_wallet);

CREATE TABLE IF NOT EXISTS public.nft_auction_bids (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auction_id UUID NOT NULL REFERENCES public.nft_auctions(id) ON DELETE CASCADE,
  bidder_wallet TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('SOL', 'USDC')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (
    status IN (
      'pending_deposit',
      'active',
      'outbid',
      'won',
      'refunded',
      'expired'
    )
  ),
  deposit_tx_signature TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ,
  outbid_at TIMESTAMPTZ,
  refund_tx_signature TEXT,
  refunded_at TIMESTAMPTZ,
  CONSTRAINT nft_auction_bids_deposit_tx_unique UNIQUE (deposit_tx_signature)
);

CREATE INDEX IF NOT EXISTS nft_auction_bids_auction_id_idx
  ON public.nft_auction_bids (auction_id);
CREATE INDEX IF NOT EXISTS nft_auction_bids_bidder_wallet_idx
  ON public.nft_auction_bids (bidder_wallet);
CREATE INDEX IF NOT EXISTS nft_auction_bids_auction_status_idx
  ON public.nft_auction_bids (auction_id, status);

ALTER TABLE public.nft_auctions
  ADD CONSTRAINT nft_auctions_current_bid_id_fkey
  FOREIGN KEY (current_bid_id) REFERENCES public.nft_auction_bids(id) ON DELETE SET NULL;

ALTER TABLE public.nft_auctions
  ADD CONSTRAINT nft_auctions_winning_bid_id_fkey
  FOREIGN KEY (winning_bid_id) REFERENCES public.nft_auction_bids(id) ON DELETE SET NULL;

ALTER TABLE public.nft_auctions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nft_auction_bids ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.nft_auctions IS 'Partner-gated English auctions; API uses service role.';
COMMENT ON TABLE public.nft_auction_bids IS 'Auction bid deposits held in funds escrow; API uses service role.';
COMMENT ON COLUMN public.nft_auctions.reserve_price IS 'Optional minimum clearing price; amount hidden from clients when reserve_hidden.';
COMMENT ON COLUMN public.nft_auctions.fee_bps_applied IS 'Snapshot of raffle-tier fee (2/3/6%) at create time.';
