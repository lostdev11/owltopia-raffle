-- Reduce Disk IO from public raffle list polling and live-activity reads.
-- 1) Batch SQL aggregates for list/carousel (replaces N× full entry select('*') polls)
-- 2) Hot-path indexes for entry ordering + live activity + nesting counts

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

-- Hot path: getEntriesByRaffleId ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_entries_raffle_created_at
  ON public.entries (raffle_id, created_at DESC);

-- Hot path: GET /api/public/live-activity (confirmed + verified_at DESC)
CREATE INDEX IF NOT EXISTS idx_entries_confirmed_verified_at
  ON public.entries (verified_at DESC)
  WHERE status = 'confirmed' AND verified_at IS NOT NULL;

-- Nesting progress counts: pool_id + status
CREATE INDEX IF NOT EXISTS idx_staking_positions_pool_status
  ON public.staking_positions (pool_id, status);
