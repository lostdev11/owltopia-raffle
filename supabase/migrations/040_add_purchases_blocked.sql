-- Admin can flag raffles to block ticket purchases (e.g. NFT not in escrow, wrong prize, dispute).
-- When set, entries/create returns 400 and no new tickets can be bought.

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS purchases_blocked_at TIMESTAMPTZ;

COMMENT ON COLUMN raffles.purchases_blocked_at IS 'When admin blocked ticket purchases (e.g. NFT not in escrow). Null = purchases allowed.';
