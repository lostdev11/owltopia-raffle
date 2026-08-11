-- Paste in Supabase SQL Editor NOW (migration 213 does the same).
-- After Coffeeoholic creates an Incoming Webhook in #raffles-fcfs-wl (983157508145319920),
-- fill WEBHOOK_URL below (same URL can be used for created + winner).

UPDATE public.discord_giveaway_partner_tenants
SET
  discord_guild_id = '915558633230712852',
  contact_note = 'Partner Pro paid. Bot channel 983157508145319920 (☘️ | raffles-fcfs-wl). Set raffle webhooks when ready.',
  updated_at = NOW()
WHERE id = 'a7c3e91b-4f2d-4c8a-9e15-6b0d2f8a1c47';

-- Uncomment and paste webhook URL(s) once created in Discord:
-- UPDATE public.discord_giveaway_partner_tenants
-- SET
--   raffle_webhook_url_created = 'https://discord.com/api/webhooks/...',
--   raffle_webhook_url_winner  = 'https://discord.com/api/webhooks/...',  -- can be the same URL
--   webhook_url                = 'https://discord.com/api/webhooks/...',  -- optional NFT/API feed
--   updated_at = NOW()
-- WHERE id = 'a7c3e91b-4f2d-4c8a-9e15-6b0d2f8a1c47';

SELECT id, name, discord_guild_id, status,
       raffle_webhook_url_created IS NOT NULL AS created_wh_set,
       raffle_webhook_url_winner IS NOT NULL AS winner_wh_set
FROM public.discord_giveaway_partner_tenants
WHERE id = 'a7c3e91b-4f2d-4c8a-9e15-6b0d2f8a1c47';
