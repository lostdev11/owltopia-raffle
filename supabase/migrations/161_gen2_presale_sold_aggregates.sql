-- Reliable aggregates for presale progress (avoids PostgREST pagination edge cases).
-- sold_confirmed: spots tied to confirmed purchase rows.
-- purchased_mints_total: sum of purchased credits from balances (presale buys only; excludes gifted_mints).

CREATE OR REPLACE FUNCTION public.gen2_presale_sold_confirmed_quantity()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(quantity), 0)::integer
  FROM gen2_presale_purchases
  WHERE status = 'confirmed';
$$;

CREATE OR REPLACE FUNCTION public.gen2_presale_sum_purchased_mints()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(purchased_mints), 0)::integer
  FROM gen2_presale_balances;
$$;

REVOKE ALL ON FUNCTION public.gen2_presale_sold_confirmed_quantity() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.gen2_presale_sum_purchased_mints() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gen2_presale_sold_confirmed_quantity() TO service_role;
GRANT EXECUTE ON FUNCTION public.gen2_presale_sum_purchased_mints() TO service_role;
