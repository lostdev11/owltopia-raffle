-- Point GOATS Partner Pro allowlist + Discord tenant at the host creator wallet
-- (setup fee was paid from a different wallet).

INSERT INTO public.partner_community_creators (
  creator_wallet,
  display_label,
  partner_tier,
  sort_order,
  is_active,
  discord_partner_tenant_id
)
VALUES (
  'ArGjwwFwLcMy5WYYmpb7gx9FFBUovFewUBeu55nLbpVf',
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

-- Deactivate the fee-payer wallet so GOATS hosting/tickets are gated to the creator above.
UPDATE public.partner_community_creators
SET
  is_active = false,
  discord_partner_tenant_id = NULL,
  updated_at = NOW()
WHERE creator_wallet = 'BwfWJ1NxX5vBifv4bz7EoNMgQinMCbR33s9nPfnGVQdu';

UPDATE public.discord_giveaway_partner_tenants
SET
  created_by_wallet = 'ArGjwwFwLcMy5WYYmpb7gx9FFBUovFewUBeu55nLbpVf',
  contact_note = 'GOATS Partner Pro — creator wallet ArGjwwFwLcMy5WYYmpb7gx9FFBUovFewUBeu55nLbpVf; Cave Creative webhook linked',
  updated_at = NOW()
WHERE id = 'a7c3e91b-4f2d-4c8a-9e15-6b0d2f8a1c47';
