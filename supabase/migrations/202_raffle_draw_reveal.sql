-- Provably-auditable raffle draw (v1): seed, index, ledger hash, on-chain reveal memo tx.
-- Enables FFF-shaped verify links; algo column allows future commit–reveal / VRF upgrades.

ALTER TABLE raffles
  ADD COLUMN IF NOT EXISTS draw_algo text,
  ADD COLUMN IF NOT EXISTS draw_seed text,
  ADD COLUMN IF NOT EXISTS draw_sold_count integer,
  ADD COLUMN IF NOT EXISTS draw_winner_index integer,
  ADD COLUMN IF NOT EXISTS draw_ledger_hash text,
  ADD COLUMN IF NOT EXISTS draw_reveal_tx text,
  ADD COLUMN IF NOT EXISTS draw_revealed_at timestamptz;

COMMENT ON COLUMN raffles.draw_algo IS 'Draw algorithm id, e.g. owltopia-draw-v1';
COMMENT ON COLUMN raffles.draw_seed IS 'Public draw seed (base58 pubkey) used to derive winner index';
COMMENT ON COLUMN raffles.draw_sold_count IS 'Confirmed ticket weight at draw time';
COMMENT ON COLUMN raffles.draw_winner_index IS 'Winning ticket index in [0, draw_sold_count)';
COMMENT ON COLUMN raffles.draw_ledger_hash IS 'SHA-256 hex of canonical wallet:tickets ledger';
COMMENT ON COLUMN raffles.draw_reveal_tx IS 'Solana memo reveal transaction signature';
COMMENT ON COLUMN raffles.draw_revealed_at IS 'When the reveal memo tx was confirmed';

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_draw_sold_count_check;
ALTER TABLE raffles
  ADD CONSTRAINT raffles_draw_sold_count_check
  CHECK (draw_sold_count IS NULL OR draw_sold_count > 0);

ALTER TABLE raffles
  DROP CONSTRAINT IF EXISTS raffles_draw_winner_index_check;
ALTER TABLE raffles
  ADD CONSTRAINT raffles_draw_winner_index_check
  CHECK (
    draw_winner_index IS NULL
    OR (
      draw_winner_index >= 0
      AND (draw_sold_count IS NULL OR draw_winner_index < draw_sold_count)
    )
  );
