-- Community vote (#community-vote): creators may disable automatic Round 2 on min-threshold miss.
-- Default ON preserves legacy behavior for existing rows and raffles created without an explicit choice.
ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS second_round_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.raffles.second_round_enabled IS
  'When true (default), min-threshold miss at first end_time extends once (2nd selling round). When false, refunds activate immediately after Round 1 if threshold not met.';
