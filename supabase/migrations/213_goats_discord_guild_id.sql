-- GOATS Partner Pro: attach Cave Creative Discord guild id from partner setup.
-- Channel they granted the bot: 983157508145319920 (☘️ | raffles-fcfs-wl).
-- Webhook URLs still NULL until an Incoming Webhook is created in that channel
-- and saved (admin UI, slash commands, or UPDATE below).

UPDATE public.discord_giveaway_partner_tenants
SET
  discord_guild_id = '915558633230712852',
  contact_note = 'Partner Pro $100 setup paid. Bot access limited to channel 983157508145319920 (☘️ | raffles-fcfs-wl) in Cave Creative. Create Incoming Webhook(s) in that channel and set raffle_webhook_url_created + raffle_webhook_url_winner (same URL ok for both).',
  updated_at = NOW()
WHERE id = 'a7c3e91b-4f2d-4c8a-9e15-6b0d2f8a1c47';

-- Keep partner wallet linked (idempotent).
UPDATE public.partner_community_creators
SET
  discord_partner_tenant_id = 'a7c3e91b-4f2d-4c8a-9e15-6b0d2f8a1c47',
  display_label = 'GOATS OF SOLANA',
  partner_tier = 'partner_pro',
  is_active = true,
  updated_at = NOW()
WHERE creator_wallet = 'BwfWJ1NxX5vBifv4bz7EoNMgQinMCbR33s9nPfnGVQdu';
