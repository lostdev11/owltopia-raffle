-- Track whether a mint event has been announced to the GEN2 Discord mint-feed channel.
-- Lets confirm-mint, reconcile backfill, and duplicate_tx retries share one idempotent notify path
-- without double-posting cards when mobile reconcile wins the race.

ALTER TABLE public.owl_center_mint_events
  ADD COLUMN IF NOT EXISTS discord_feed_posted_at timestamptz;

COMMENT ON COLUMN public.owl_center_mint_events.discord_feed_posted_at IS
  'When the GEN2 Discord mint-feed webhook posted this tx (null = pending). Service role only.';

-- Existing ledger rows predate the dedupe column — treat them as already handled so deploy does not
-- replay the full mint history into #gen2-mints. Only newly recorded mints stay pending (NULL).
UPDATE public.owl_center_mint_events
SET discord_feed_posted_at = created_at
WHERE discord_feed_posted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_owl_center_mint_events_discord_pending
  ON public.owl_center_mint_events (launch_id, created_at)
  WHERE discord_feed_posted_at IS NULL;
