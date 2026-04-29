-- Public browse vs. partner "Discord / link only": when false, raffle is omitted from
-- GET /api/raffles, /raffles listing, and partner strips — still reachable at /raffles/{slug}.

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS list_on_platform boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.raffles.list_on_platform IS
  'If true (default), show on the public raffles list and in list APIs. If false, partner/creator can share the slug URL in Discord; entry flow is unchanged.';

-- Keep raffles_list in sync (see 060_raffle_prize_amount_precision.sql).
DROP VIEW IF EXISTS public.raffles_list CASCADE;

CREATE VIEW public.raffles_list AS
SELECT *
FROM public.raffles;

ALTER VIEW public.raffles_list SET (security_invoker = on);

GRANT SELECT ON public.raffles_list TO anon, authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_raffles_list_on_platform
  ON public.raffles (list_on_platform)
  WHERE list_on_platform = true;
