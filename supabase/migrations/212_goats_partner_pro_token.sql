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

-- Partner Pro host wallet (paid $100 USDC setup). Discord tenant linking is ops/admin.
INSERT INTO public.partner_community_creators (
  creator_wallet,
  display_label,
  partner_tier,
  sort_order,
  is_active
)
VALUES (
  'BwfWJ1NxX5vBifv4bz7EoNMgQinMCbR33s9nPfnGVQdu',
  'GOATS OF SOLANA',
  'partner_pro',
  100,
  true
)
ON CONFLICT (creator_wallet) DO UPDATE SET
  display_label = EXCLUDED.display_label,
  partner_tier = EXCLUDED.partner_tier,
  is_active = true,
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
