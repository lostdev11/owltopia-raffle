-- Owl Council: vote lock + weight source from Nesting (OWL token pool) after app cutoff.
-- Run after 104. Adds council governance staking pool (inactive until admin sets OWL mint + activates).

ALTER TABLE public.owl_votes
  ADD COLUMN IF NOT EXISTS council_vote_used_nesting BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.owl_votes.council_vote_used_nesting IS
  'When true, voting_power came from OWL staked in Owl Council governance nesting pool; that weight is non-withdrawable from the pool until open proposal votes end.';

-- Sum TRUNC(voting_power * 10^decimals) for nesting-weight votes on active proposals in voting window.
CREATE OR REPLACE FUNCTION public.owl_council_nesting_vote_locked_raw(
  p_wallet text,
  p_decimals int
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(TRUNC(v.voting_power * power(10::numeric, p_decimals))),
    0::numeric
  )
  FROM public.owl_votes v
  INNER JOIN public.owl_proposals p ON p.id = v.proposal_id
  WHERE btrim(v.wallet_address) = btrim(p_wallet)
    AND v.council_vote_used_nesting = TRUE
    AND p.status = 'active'
    AND now() >= p.start_time
    AND now() <= p.end_time;
$$;

REVOKE ALL ON FUNCTION public.owl_council_nesting_vote_locked_raw(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.owl_council_nesting_vote_locked_raw(text, int) TO service_role;

COMMENT ON FUNCTION public.owl_council_nesting_vote_locked_raw(text, int) IS
  'Raw OWL units (per p_decimals) locked from nesting-weight votes while proposal voting is open.';

CREATE OR REPLACE FUNCTION public.staking_sum_active_amount_for_pool(
  p_wallet text,
  p_pool_id uuid
) RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    SUM(sp.amount),
    0::numeric
  )
  FROM public.staking_positions sp
  WHERE btrim(sp.wallet_address) = btrim(p_wallet)
    AND sp.pool_id = p_pool_id
    AND sp.status = 'active';
$$;

REVOKE ALL ON FUNCTION public.staking_sum_active_amount_for_pool(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staking_sum_active_amount_for_pool(text, uuid) TO service_role;

-- Token pool: set token_mint to your OWL mint in admin before activating.
INSERT INTO public.staking_pools (
  name,
  slug,
  description,
  asset_type,
  token_mint,
  collection_key,
  reward_token,
  reward_rate,
  reward_rate_unit,
  lock_period_days,
  minimum_stake,
  maximum_stake,
  platform_fee_bps,
  is_active,
  display_order,
  partner_project_slug,
  created_by,
  adapter_mode,
  is_onchain_enabled,
  requires_onchain_sync,
  lock_enforcement_source
)
VALUES (
  'Owl Council — OWL governance',
  'owl-council-governance',
  'Stake OWL here for Owl Council voting weight (same rules as legacy council escrow after migration cutoff). Unstake is limited while you have weight committed to open votes.',
  'token',
  NULL,
  NULL,
  NULL,
  0,
  'daily',
  0,
  NULL,
  NULL,
  0,
  FALSE,
  1,
  NULL,
  'owl-council-nesting-migration',
  'mock',
  FALSE,
  FALSE,
  'database'
)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  asset_type = EXCLUDED.asset_type,
  updated_at = NOW();
