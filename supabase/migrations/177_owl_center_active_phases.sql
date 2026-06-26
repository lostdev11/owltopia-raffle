-- Concurrent live phases for Owl Center launches.
--
-- Until now exactly ONE phase was mintable at a time (`active_phase`). `active_phases` is an
-- explicit admin-controlled list of EXTRA phases that are also live concurrently, so e.g. WHITELIST
-- and PUBLIC can both accept mints at the same time. The on-chain candy guard already supports this
-- (each group is gated only by its own startDate/endDate), so this is an off-chain gate change.
--
-- Back-compat: empty array == legacy single-phase behavior (only `active_phase` is live, plus the
-- existing Gen1 7-day airdrop window). `active_phase` stays the "primary" phase used for defaults.

ALTER TABLE owl_center_launches
  ADD COLUMN IF NOT EXISTS active_phases jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN owl_center_launches.active_phases IS
  'Extra phases that are live concurrently with active_phase (array of phase keys: AIRDROP, PRESALE, PRESALE_OVERAGE, WHITELIST, PUBLIC). Empty = legacy single-phase behavior.';
