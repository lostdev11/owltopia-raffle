-- Batch entry counts for public giveaway browse (one query instead of N).

CREATE OR REPLACE FUNCTION public.count_community_giveaway_entries_for_ids(p_ids uuid[])
RETURNS TABLE (giveaway_id uuid, entry_count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT e.giveaway_id, COUNT(*)::bigint AS entry_count
  FROM public.community_giveaway_entries e
  WHERE e.giveaway_id = ANY (p_ids)
  GROUP BY e.giveaway_id;
$$;

COMMENT ON FUNCTION public.count_community_giveaway_entries_for_ids(uuid[]) IS
  'Returns entry counts per giveaway id for browse/list endpoints.';

GRANT EXECUTE ON FUNCTION public.count_community_giveaway_entries_for_ids(uuid[]) TO service_role;
