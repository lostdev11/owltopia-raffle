-- Accurate per-raffle counts for admin "Manual ticket refunds" (avoid 25k row cap on raw entry scans).

CREATE OR REPLACE FUNCTION public.list_raffle_unrefunded_confirmed_entry_counts()
RETURNS TABLE (raffle_id UUID, unrefunded_entry_count BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT e.raffle_id, COUNT(*)::BIGINT AS unrefunded_entry_count
  FROM public.entries e
  WHERE e.status = 'confirmed'
    AND e.refunded_at IS NULL
  GROUP BY e.raffle_id
  ORDER BY unrefunded_entry_count DESC;
$$;

COMMENT ON FUNCTION public.list_raffle_unrefunded_confirmed_entry_counts() IS
  'Admin: one row per raffle with confirmed tickets not yet marked refunded (manual record or pending claim).';

GRANT EXECUTE ON FUNCTION public.list_raffle_unrefunded_confirmed_entry_counts() TO service_role;
