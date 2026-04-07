-- Atomic +1 draw_weight with boost row (max total weight 4 = 1 base + 3 OWL).
-- Uses RETURNS TABLE(...) so we do not depend on the table row composite type (avoids 42704 in some environments).

DROP FUNCTION IF EXISTS apply_community_giveaway_owl_boost(uuid, text);

CREATE OR REPLACE FUNCTION apply_community_giveaway_owl_boost(p_entry_id uuid, p_tx text)
RETURNS TABLE (
  id uuid,
  giveaway_id uuid,
  wallet_address text,
  draw_weight integer,
  created_at timestamptz
)
LANGUAGE plpgsql
AS $$
DECLARE
  trimmed text := trim(p_tx);
BEGIN
  IF trimmed = '' OR trimmed IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.community_giveaway_owl_boosts (entry_id, tx_signature)
  VALUES (p_entry_id, trimmed);

  RETURN QUERY
  UPDATE public.community_giveaway_entries e
  SET draw_weight = e.draw_weight + 1
  WHERE e.id = p_entry_id AND e.draw_weight < 4
  RETURNING e.id, e.giveaway_id, e.wallet_address, e.draw_weight, e.created_at;

  IF NOT FOUND THEN
    DELETE FROM public.community_giveaway_owl_boosts WHERE tx_signature = trimmed;
  END IF;

  RETURN;
EXCEPTION
  WHEN unique_violation THEN
    RAISE;
END;
$$;

COMMENT ON FUNCTION apply_community_giveaway_owl_boost(uuid, text) IS
  'Inserts OWL boost tx and increments draw_weight by 1 if below max (4). Rolls back insert if at max.';

GRANT EXECUTE ON FUNCTION apply_community_giveaway_owl_boost(uuid, text) TO service_role;
