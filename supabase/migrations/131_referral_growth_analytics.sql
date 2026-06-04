-- Creator referral growth: reward settings, reward ledger, raffle views, entry reward audit fields.

CREATE TABLE IF NOT EXISTS public.referral_reward_settings (
  id text PRIMARY KEY DEFAULT 'default',
  reward_mode text NOT NULL DEFAULT 'free_entry'
    CHECK (reward_mode IN ('free_entry', 'owl_token', 'disabled')),
  campaign_key text NOT NULL DEFAULT 'default',
  campaign_starts_at timestamptz NULL,
  campaign_ends_at timestamptz NULL,
  owl_reward_amount numeric NULL,
  monthly_cap_holder integer NOT NULL DEFAULT 5,
  monthly_cap_non_holder integer NOT NULL DEFAULT 1,
  buyer_complimentary_enabled boolean NOT NULL DEFAULT false,
  allow_multiple_per_campaign boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_wallet text NULL
);

INSERT INTO public.referral_reward_settings (id, reward_mode, campaign_key, updated_at)
VALUES ('default', 'free_entry', 'default', now())
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.referral_reward_settings ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.referral_reward_settings IS
  'Admin-controlled referral reward mode; changes apply to future issuances only. API + service role writes.';

GRANT SELECT ON public.referral_reward_settings TO service_role;

CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_key text NOT NULL DEFAULT 'default',
  calendar_month text NOT NULL,
  reward_recipient_role text NOT NULL CHECK (reward_recipient_role IN ('buyer', 'referrer')),
  raffle_id uuid NULL REFERENCES public.raffles(id) ON DELETE SET NULL,
  referrer_wallet text NOT NULL,
  referral_code text NOT NULL,
  referred_wallet text NULL,
  reward_mode text NOT NULL DEFAULT 'free_entry'
    CHECK (reward_mode IN ('free_entry', 'owl_token', 'disabled')),
  reward_status text NOT NULL DEFAULT 'pending'
    CHECK (reward_status IN ('pending', 'confirmed', 'expired', 'void')),
  trigger_entry_id uuid NULL REFERENCES public.entries(id) ON DELETE SET NULL,
  free_entry_id uuid NULL REFERENCES public.entries(id) ON DELETE SET NULL,
  owl_reward_amount numeric NULL,
  owl_reward_tx_signature text NULL,
  referrer_is_holder_at_issue boolean NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz NULL,
  expired_at timestamptz NULL,
  voided_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referrer_month
  ON public.referral_rewards (referrer_wallet, calendar_month)
  WHERE reward_recipient_role = 'referrer'
    AND reward_status IN ('pending', 'confirmed');

CREATE INDEX IF NOT EXISTS idx_referral_rewards_referred_wallet
  ON public.referral_rewards (referred_wallet)
  WHERE referred_wallet IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_rewards_trigger_entry
  ON public.referral_rewards (trigger_entry_id)
  WHERE trigger_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_referral_rewards_status
  ON public.referral_rewards (reward_status, issued_at DESC);

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.referral_rewards IS
  'Audit ledger for referral free-entry (and future OWL) rewards. API + service role only.';

GRANT SELECT, INSERT, UPDATE ON public.referral_rewards TO service_role;

CREATE TABLE IF NOT EXISTS public.raffle_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raffle_id uuid NOT NULL REFERENCES public.raffles(id) ON DELETE CASCADE,
  viewer_wallet text NULL,
  session_id text NULL,
  referrer_wallet text NULL,
  referral_code_used text NULL,
  user_agent text NULL,
  ip_hash text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raffle_views_raffle_created
  ON public.raffle_views (raffle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_raffle_views_session_raffle
  ON public.raffle_views (raffle_id, session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_raffle_views_referral_code
  ON public.raffle_views (referral_code_used, created_at DESC)
  WHERE referral_code_used IS NOT NULL;

ALTER TABLE public.raffle_views ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.raffle_views IS
  'Lightweight raffle page views; ip_hash only (no raw IP). Writes via service role API.';

GRANT SELECT, INSERT ON public.raffle_views TO service_role;

ALTER TABLE public.entries
  ADD COLUMN IF NOT EXISTS reward_mode_at_issue text NULL,
  ADD COLUMN IF NOT EXISTS reward_issued_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reward_confirmed_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS reward_status text NULL,
  ADD COLUMN IF NOT EXISTS referral_reward_id uuid NULL REFERENCES public.referral_rewards(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_entries_raffle_referrer
  ON public.entries (raffle_id, referrer_wallet)
  WHERE referrer_wallet IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entries_raffle_referral_code
  ON public.entries (raffle_id, referral_code_used)
  WHERE referral_code_used IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entries_status_raffle
  ON public.entries (status, raffle_id);
