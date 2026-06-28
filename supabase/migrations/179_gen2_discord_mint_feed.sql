-- GEN2 Discord mint feed: persists the id of the single "live progress" status message
-- per launch+network so the bot can EDIT it in place (instead of spamming a new one on
-- every mint). Per-mint embeds are fire-and-forget and need no state. Writes happen only
-- from the Next.js confirm-mint background task via getSupabaseAdmin() (service role).

CREATE TABLE IF NOT EXISTS public.owl_center_discord_mint_feed (
  -- One row per feed channel, keyed `${launch_slug}-${network}` (e.g. gen2-mainnet).
  id text PRIMARY KEY,
  launch_slug text NOT NULL,
  network text NOT NULL DEFAULT 'mainnet',
  -- Discord message id of the live progress/status message (null until first posted).
  status_message_id text,
  -- Last total minted we rendered into the status message (skip no-op edits).
  last_minted int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.owl_center_discord_mint_feed ENABLE ROW LEVEL SECURITY;
-- API + service role only (no anon/authenticated policy): mirrors migration 020 pattern.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owl_center_discord_mint_feed TO service_role;

COMMENT ON TABLE public.owl_center_discord_mint_feed IS
  'Live GEN2 mint-feed Discord status message ids (one row per launch+network). Writes via Next.js service role only.';
