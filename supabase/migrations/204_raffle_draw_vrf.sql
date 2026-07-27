-- VRF draw (v3): Switchboard on-demand randomness as seed source.
-- Request only when canSelectWinner; never on second-round extension / refund paths.

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS draw_vrf_provider text,
  ADD COLUMN IF NOT EXISTS draw_vrf_status text,
  ADD COLUMN IF NOT EXISTS draw_vrf_account text,
  ADD COLUMN IF NOT EXISTS draw_vrf_request_tx text,
  ADD COLUMN IF NOT EXISTS draw_vrf_fulfill_tx text,
  ADD COLUMN IF NOT EXISTS draw_vrf_error text,
  ADD COLUMN IF NOT EXISTS draw_vrf_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS draw_vrf_fulfilled_at timestamptz;

COMMENT ON COLUMN public.raffles.draw_vrf_provider IS
  'Randomness provider id, e.g. switchboard';
COMMENT ON COLUMN public.raffles.draw_vrf_status IS
  'pending | failed | fulfilled — null when unused';
COMMENT ON COLUMN public.raffles.draw_vrf_account IS
  'Switchboard randomness account pubkey';
COMMENT ON COLUMN public.raffles.draw_vrf_request_tx IS
  'Commit (request) transaction signature';
COMMENT ON COLUMN public.raffles.draw_vrf_fulfill_tx IS
  'Reveal (fulfill) transaction signature';
COMMENT ON COLUMN public.raffles.draw_vrf_error IS
  'Last VRF error message for admin retry UX';
COMMENT ON COLUMN public.raffles.draw_vrf_requested_at IS
  'When commit tx was confirmed';
COMMENT ON COLUMN public.raffles.draw_vrf_fulfilled_at IS
  'When reveal tx was confirmed';

ALTER TABLE public.raffles
  DROP CONSTRAINT IF EXISTS raffles_draw_vrf_status_check;
ALTER TABLE public.raffles
  ADD CONSTRAINT raffles_draw_vrf_status_check
  CHECK (
    draw_vrf_status IS NULL
    OR draw_vrf_status IN ('pending', 'failed', 'fulfilled')
  );
