-- Extra fields for community giveaway prize escrow (parity with raffles). Safe if columns already exist.

ALTER TABLE community_giveaways ADD COLUMN IF NOT EXISTS nft_token_id TEXT;
ALTER TABLE community_giveaways ADD COLUMN IF NOT EXISTS prize_standard TEXT;
ALTER TABLE community_giveaways ADD COLUMN IF NOT EXISTS prize_deposit_tx TEXT;
