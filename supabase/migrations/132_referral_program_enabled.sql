-- Admin toggle: referral program (attribution, capture, rewards, dashboard UI) without redeploy.

ALTER TABLE public.referral_reward_settings
  ADD COLUMN IF NOT EXISTS program_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.referral_reward_settings.program_enabled IS
  'Master switch for the referral program. When false, attribution/capture/rewards/UI are off. Env kill switches still apply.';
