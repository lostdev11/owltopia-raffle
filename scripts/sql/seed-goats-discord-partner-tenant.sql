-- Run in Supabase SQL Editor if you want GOATS Partner Pro Discord tenant live
-- before migration 212 is applied via normal migrate flow.
-- After creating ☘️︱new-raffles and ☘️︱raffle-winners in their Discord:
--   1) Create an Incoming Webhook in each channel
--   2) UPDATE the two raffle_webhook_url_* columns below (or use /admin/discord-giveaway-partners)
--   3) SET discord_guild_id to their server id
--   4) Rotate API secret in admin UI

INSERT INTO public.discord_giveaway_partner_tenants (
  id,
  name,
  discord_guild_id,
  webhook_url,
  raffle_webhook_url_created,
  raffle_webhook_url_winner,
  api_secret_hash,
  status,
  active_until,
  contact_note,
  created_by_wallet
)
VALUES (
  'a7c3e91b-4f2d-4c8a-9e15-6b0d2f8a1c47',
  'GOATS OF SOLANA',
  NULL, -- set after you join their Discord (Server Settings → Widget / copy from invite)
  NULL,
  NULL, -- paste webhook from ☘️︱new-raffles
  NULL, -- paste webhook from ☘️︱raffle-winners
  encode(sha256('goats-partner-pro-placeholder-rotate-via-admin'::bytea), 'hex'),
  'active',
  NULL,
  'Partner Pro $100 setup paid. Create channels + paste webhooks; rotate API secret in admin.',
  'BwfWJ1NxX5vBifv4bz7EoNMgQinMCbR33s9nPfnGVQdu'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = 'active',
  active_until = NULL,
  contact_note = EXCLUDED.contact_note,
  updated_at = NOW();

INSERT INTO public.partner_community_creators (
  creator_wallet,
  display_label,
  partner_tier,
  sort_order,
  is_active,
  discord_partner_tenant_id
)
VALUES (
  'BwfWJ1NxX5vBifv4bz7EoNMgQinMCbR33s9nPfnGVQdu',
  'GOATS OF SOLANA',
  'partner_pro',
  100,
  true,
  'a7c3e91b-4f2d-4c8a-9e15-6b0d2f8a1c47'
)
ON CONFLICT (creator_wallet) DO UPDATE SET
  display_label = EXCLUDED.display_label,
  partner_tier = EXCLUDED.partner_tier,
  is_active = true,
  discord_partner_tenant_id = EXCLUDED.discord_partner_tenant_id,
  updated_at = NOW();

-- After you have webhook URLs + guild id, run (fill in the blanks):
-- UPDATE public.discord_giveaway_partner_tenants
-- SET
--   discord_guild_id = '<GUILD_ID>',
--   raffle_webhook_url_created = 'https://discord.com/api/webhooks/...',  -- new-raffles
--   raffle_webhook_url_winner  = 'https://discord.com/api/webhooks/...',  -- raffle-winners
--   updated_at = NOW()
-- WHERE id = 'a7c3e91b-4f2d-4c8a-9e15-6b0d2f8a1c47';
