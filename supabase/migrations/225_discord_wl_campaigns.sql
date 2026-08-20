-- Partner Discord whitelist collection campaigns + submissions.
-- Intake pipe only; mint eligibility still reads owl_center_launch_wl_wallets.

CREATE TABLE IF NOT EXISTS public.discord_wl_campaigns (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  discord_guild_id text NOT NULL,
  partner_tenant_id uuid NOT NULL REFERENCES public.discord_giveaway_partner_tenants(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  message_id text,
  name text NOT NULL,
  phase_key text NOT NULL DEFAULT 'wl',
  launch_id uuid REFERENCES public.owl_center_launches(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
  max_entries int CHECK (max_entries IS NULL OR max_entries > 0),
  spots_per_wallet int NOT NULL DEFAULT 1 CHECK (spots_per_wallet >= 1),
  required_role_id text,
  required_role_name text,
  created_by_wallet text NOT NULL,
  created_by_discord_user_id text NOT NULL,
  opened_at timestamptz,
  closed_at timestamptz,
  last_pushed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discord_wl_campaigns_name_nonempty CHECK (char_length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_discord_wl_campaigns_guild_status
  ON public.discord_wl_campaigns (discord_guild_id, status);

CREATE INDEX IF NOT EXISTS idx_discord_wl_campaigns_tenant
  ON public.discord_wl_campaigns (partner_tenant_id);

CREATE INDEX IF NOT EXISTS idx_discord_wl_campaigns_launch
  ON public.discord_wl_campaigns (launch_id)
  WHERE launch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_discord_wl_campaigns_created_by
  ON public.discord_wl_campaigns (created_by_wallet);

COMMENT ON TABLE public.discord_wl_campaigns IS
  'Partner Pro Discord whitelist spots (open/close). Intake only; Owl Center launch WL wallets remain mint source of truth.';

CREATE TABLE IF NOT EXISTS public.discord_wl_submissions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  campaign_id bigint NOT NULL REFERENCES public.discord_wl_campaigns(id) ON DELETE CASCADE,
  discord_user_id text NOT NULL,
  discord_username text,
  wallet text NOT NULL,
  source text NOT NULL CHECK (source IN ('linked_wallet', 'modal')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT discord_wl_submissions_user_unique UNIQUE (campaign_id, discord_user_id),
  CONSTRAINT discord_wl_submissions_wallet_unique UNIQUE (campaign_id, wallet)
);

CREATE INDEX IF NOT EXISTS idx_discord_wl_submissions_campaign_created
  ON public.discord_wl_submissions (campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_discord_wl_submissions_wallet
  ON public.discord_wl_submissions (wallet);

COMMENT ON TABLE public.discord_wl_submissions IS
  'One Discord user and one Solana wallet per whitelist campaign. Wallets are never posted in public chat.';

ALTER TABLE public.discord_wl_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_wl_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS discord_wl_campaigns_deny_all ON public.discord_wl_campaigns;
CREATE POLICY discord_wl_campaigns_deny_all
  ON public.discord_wl_campaigns
  FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS discord_wl_submissions_deny_all ON public.discord_wl_submissions;
CREATE POLICY discord_wl_submissions_deny_all
  ON public.discord_wl_submissions
  FOR ALL
  USING (false)
  WITH CHECK (false);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.discord_wl_campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.discord_wl_submissions TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.discord_wl_campaigns_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.discord_wl_submissions_id_seq TO service_role;
