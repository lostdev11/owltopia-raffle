-- Per-partner Discord: separate incoming webhooks for ticket-raffle "created" and "winner" (parity with platform DISCORD_WEBHOOK_RAFFLE_*).
-- partner_community_creators: link allowlisted host wallet to a partner tenant; new raffles copy tenant id for webhook routing.
--
-- If `discord_giveaway_partner_tenants` is missing, apply `052_discord_giveaway_partner_tenants.sql` first, then re-run
-- this migration, OR run the block below: we still add `discord_partner_tenant_id` on raffles / partner rows as plain UUIDs
-- (no FK) so deploys do not hard-fail.

-- ---------------------------------------------------------------------------
-- When partner tenants table exists (expected after migration 052)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.discord_giveaway_partner_tenants') IS NOT NULL THEN
    ALTER TABLE public.discord_giveaway_partner_tenants
      ADD COLUMN IF NOT EXISTS raffle_webhook_url_created TEXT,
      ADD COLUMN IF NOT EXISTS raffle_webhook_url_winner TEXT;

    COMMENT ON COLUMN public.discord_giveaway_partner_tenants.raffle_webhook_url_created IS
      'Optional: Discord incoming webhook for new ticket raffles created by a linked partner creator.';
    COMMENT ON COLUMN public.discord_giveaway_partner_tenants.raffle_webhook_url_winner IS
      'Optional: Discord incoming webhook when a ticket raffle draw completes (claim on site dashboard).';
  ELSE
    RAISE NOTICE
      '084: table discord_giveaway_partner_tenants not found — run 052_discord_giveaway_partner_tenants.sql, then re-run 084 to add partner webhook columns and foreign keys.';
  END IF;
END
$$;

-- raffles: FK when partner table exists; otherwise store UUID only (re-run 084 after 052 to add FK)
DO $$
BEGIN
  IF to_regclass('public.raffles') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.discord_giveaway_partner_tenants') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'raffles' AND column_name = 'discord_partner_tenant_id'
    ) THEN
      ALTER TABLE public.raffles
        ADD COLUMN discord_partner_tenant_id UUID REFERENCES public.discord_giveaway_partner_tenants (id) ON DELETE SET NULL;
    END IF;
  ELSE
    -- Table 052 not applied: column without FK so migration does not error
    ALTER TABLE public.raffles
      ADD COLUMN IF NOT EXISTS discord_partner_tenant_id UUID;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'raffles' AND column_name = 'discord_partner_tenant_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_raffles_discord_partner_tenant
      ON public.raffles (discord_partner_tenant_id)
      WHERE discord_partner_tenant_id IS NOT NULL;
  END IF;
END
$$;

-- partner_community_creators (migration 062): same pattern
DO $$
BEGIN
  IF to_regclass('public.partner_community_creators') IS NULL THEN
    RETURN;
  END IF;

  IF to_regclass('public.discord_giveaway_partner_tenants') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'partner_community_creators' AND column_name = 'discord_partner_tenant_id'
    ) THEN
      ALTER TABLE public.partner_community_creators
        ADD COLUMN discord_partner_tenant_id UUID REFERENCES public.discord_giveaway_partner_tenants (id) ON DELETE SET NULL;
    END IF;
  ELSE
    ALTER TABLE public.partner_community_creators
      ADD COLUMN IF NOT EXISTS discord_partner_tenant_id UUID;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'partner_community_creators' AND column_name = 'discord_partner_tenant_id'
  ) THEN
    COMMENT ON COLUMN public.partner_community_creators.discord_partner_tenant_id IS
      'When set, new raffles from this wallet post to that tenant’s raffle webhooks.';
  END IF;
END
$$;
