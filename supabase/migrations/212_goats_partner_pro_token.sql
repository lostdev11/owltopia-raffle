-- Goats of Solana Partner Pro: allow GOATS as raffle/entry ticket currency,
-- seed partner_community_creators allowlist, and extend list-poll revenue aggregates.

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_currency_check;

ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_currency_check
  CHECK (currency IN ('USDC', 'SOL', 'OWL', 'BAMBOO', 'GOATS'));

ALTER TABLE public.entries
  DROP CONSTRAINT IF EXISTS entries_currency_check;

ALTER TABLE public.entries
  ADD CONSTRAINT entries_currency_check
  CHECK (currency IN ('USDC', 'SOL', 'OWL', 'BAMBOO', 'GOATS'));

-- Discord partner tenant (Partner Pro paid). Webhook URLs stay NULL until staff
-- creates ☘️︱new-raffles + ☘️︱raffle-winners in their Discord and pastes
-- channel webhook URLs in /admin/discord-giveaway-partners (or UPDATE below).
-- Rotate api secret via admin UI after apply (placeholder hash is not a usable secret).
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
  NULL,
  NULL,
  NULL,
  NULL,
  encode(sha256('goats-partner-pro-placeholder-rotate-via-admin'::bytea), 'hex'),
  'active',
  NULL,
  'Partner Pro $100 setup paid (tx NyMssxN2AyXkDxqvVgZcQBddrWmYd3FwXurnSKLZApp73ybbi8NP1jAwNQZVLF6LdgVP5p8HoKGSNTi579XLdtC). Create channels new-raffles + raffle-winners, set discord_guild_id + raffle_webhook_url_created/winner, rotate API secret.',
  'BwfWJ1NxX5vBifv4bz7EoNMgQinMCbR33s9nPfnGVQdu'
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = 'active',
  active_until = NULL,
  contact_note = EXCLUDED.contact_note,
  updated_at = NOW();

-- Partner Pro host wallet (paid $100 USDC setup), linked to Discord tenant above.
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

CREATE OR REPLACE FUNCTION public.summarize_entries_for_raffle_ids(
  p_ids uuid[],
  p_viewer_wallet text DEFAULT NULL
)
RETURNS TABLE (
  raffle_id uuid,
  tickets_sold bigint,
  total_entries bigint,
  confirmed_entries bigint,
  unique_wallets bigint,
  revenue_sol numeric,
  revenue_usdc numeric,
  revenue_owl numeric,
  revenue_bamboo numeric,
  revenue_goats numeric,
  viewer_confirmed_tickets bigint
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    e.raffle_id,
    COALESCE(
      SUM(e.ticket_quantity) FILTER (
        WHERE e.status = 'confirmed' AND e.refunded_at IS NULL
      ),
      0
    )::bigint AS tickets_sold,
    COUNT(*)::bigint AS total_entries,
    COUNT(*) FILTER (WHERE e.status = 'confirmed')::bigint AS confirmed_entries,
    COUNT(DISTINCT e.wallet_address) FILTER (WHERE e.status = 'confirmed')::bigint AS unique_wallets,
    COALESCE(
      SUM(e.amount_paid) FILTER (
        WHERE e.status = 'confirmed' AND upper(COALESCE(e.currency, '')) = 'SOL'
      ),
      0
    ) AS revenue_sol,
    COALESCE(
      SUM(e.amount_paid) FILTER (
        WHERE e.status = 'confirmed' AND upper(COALESCE(e.currency, '')) = 'USDC'
      ),
      0
    ) AS revenue_usdc,
    COALESCE(
      SUM(e.amount_paid) FILTER (
        WHERE e.status = 'confirmed' AND upper(COALESCE(e.currency, '')) = 'OWL'
      ),
      0
    ) AS revenue_owl,
    COALESCE(
      SUM(e.amount_paid) FILTER (
        WHERE e.status = 'confirmed' AND upper(COALESCE(e.currency, '')) = 'BAMBOO'
      ),
      0
    ) AS revenue_bamboo,
    COALESCE(
      SUM(e.amount_paid) FILTER (
        WHERE e.status = 'confirmed' AND upper(COALESCE(e.currency, '')) = 'GOATS'
      ),
      0
    ) AS revenue_goats,
    COALESCE(
      SUM(e.ticket_quantity) FILTER (
        WHERE e.status = 'confirmed'
          AND e.refunded_at IS NULL
          AND p_viewer_wallet IS NOT NULL
          AND btrim(p_viewer_wallet) <> ''
          AND e.wallet_address = btrim(p_viewer_wallet)
      ),
      0
    )::bigint AS viewer_confirmed_tickets
  FROM public.entries e
  WHERE e.raffle_id = ANY (p_ids)
  GROUP BY e.raffle_id;
$$;

COMMENT ON FUNCTION public.summarize_entries_for_raffle_ids(uuid[], text) IS
  'Batch entry aggregates for raffle list/carousel polling (tickets, revenue, owl-vision counts).';

GRANT EXECUTE ON FUNCTION public.summarize_entries_for_raffle_ids(uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION public.summarize_entries_for_raffle_ids(uuid[], text) TO anon;
GRANT EXECUTE ON FUNCTION public.summarize_entries_for_raffle_ids(uuid[], text) TO authenticated;
