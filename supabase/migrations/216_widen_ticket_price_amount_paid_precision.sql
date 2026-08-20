-- Partner SPL ticket currencies (GOATS, BAMBOO) can price tickets well above 9999.999999.
-- ticket_price / amount_paid were DECIMAL(10,6) from the SOL-era schema, so a GOATS NFT
-- listing at 30,000 GOATS/ticket failed with numeric field overflow (Postgres 22003).
--
-- Same pattern as 060_raffle_prize_amount_precision.sql: drop raffles_list (it depends on
-- raffles.ticket_price), widen, recreate SELECT * so the view stays in sync.
--
-- Operational note: ALTER TABLE takes a short ACCESS EXCLUSIVE lock on raffles/entries.
-- Ticket writes may pause briefly during that window.

DROP VIEW IF EXISTS public.raffles_list CASCADE;

ALTER TABLE public.raffles
  ALTER COLUMN ticket_price TYPE NUMERIC(38, 18)
  USING ticket_price::NUMERIC(38, 18);

COMMENT ON COLUMN public.raffles.ticket_price IS
  'Per-ticket price in raffles.currency. NUMERIC(38,18) so partner SPL tickets (GOATS/BAMBOO) can exceed the old DECIMAL(10,6) cap of 9999.999999.';

CREATE VIEW public.raffles_list AS
SELECT *
FROM public.raffles;

ALTER VIEW public.raffles_list SET (security_invoker = on);

GRANT SELECT ON public.raffles_list TO anon, authenticated, service_role;

ALTER TABLE public.entries
  ALTER COLUMN amount_paid TYPE NUMERIC(38, 18)
  USING amount_paid::NUMERIC(38, 18);

COMMENT ON COLUMN public.entries.amount_paid IS
  'Total paid for this entry in entries.currency. Widened with raffles.ticket_price so GOATS/BAMBOO purchases are not capped at 9999.999999.';

ALTER TABLE public.deleted_entries
  ALTER COLUMN amount_paid TYPE NUMERIC(38, 18)
  USING amount_paid::NUMERIC(38, 18);
