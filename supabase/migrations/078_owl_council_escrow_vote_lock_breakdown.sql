-- Per-proposal breakdown of escrow vote weight locked while voting is open (same rules as owl_council_escrow_vote_locked_raw).

CREATE OR REPLACE FUNCTION public.owl_council_escrow_vote_lock_breakdown(
  p_wallet text,
  p_decimals int
) RETURNS TABLE (
  proposal_id uuid,
  slug text,
  title text,
  locked_raw numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    p.id AS proposal_id,
    p.slug,
    p.title,
    TRUNC(v.voting_power * power(10::numeric, p_decimals)) AS locked_raw
  FROM public.owl_votes v
  INNER JOIN public.owl_proposals p ON p.id = v.proposal_id
  WHERE btrim(v.wallet_address) = btrim(p_wallet)
    AND v.council_vote_used_escrow = TRUE
    AND p.status = 'active'
    AND now() >= p.start_time
    AND now() <= p.end_time
    AND TRUNC(v.voting_power * power(10::numeric, p_decimals)) > 0::numeric
  ORDER BY p.end_time ASC NULLS LAST;
$$;

COMMENT ON FUNCTION public.owl_council_escrow_vote_lock_breakdown(text, int) IS
  'Rows of proposal + raw OWL amount locked per open vote using council escrow weight.';

REVOKE ALL ON FUNCTION public.owl_council_escrow_vote_lock_breakdown(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owl_council_escrow_vote_lock_breakdown(text, int) TO service_role;
