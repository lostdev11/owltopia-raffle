-- Per-phase mint start times (optional JSON map) + clarify launch_deadline_at as mint kickoff.

ALTER TABLE owl_center_launches
  ADD COLUMN IF NOT EXISTS phase_schedule jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN owl_center_launches.launch_deadline_at IS
  'Mint kickoff (first phase opens). Displayed as mint date — not a hard close deadline.';
COMMENT ON COLUMN owl_center_launches.phase_schedule IS
  'Optional ISO timestamps per phase key: AIRDROP, PRESALE, PRESALE_OVERAGE, WHITELIST, PUBLIC, TRADING_ACTIVE.';

-- Gen2: mint opens Jun 27 2026 — GEN1 first, other phases TBA until admin sets schedule.
UPDATE owl_center_launches
SET
  launch_deadline_at = '2026-06-27T17:00:00Z',
  phase_schedule = jsonb_build_object('AIRDROP', '2026-06-27T17:00:00Z'),
  updated_at = now()
WHERE slug = 'gen2';
