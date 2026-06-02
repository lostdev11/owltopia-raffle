-- Milestone unlock when confirmed sales reach the raffle draw goal (min_tickets / NFT floor÷ticket).
ALTER TABLE raffle_milestones DROP CONSTRAINT IF EXISTS raffle_milestones_trigger_type_check;

ALTER TABLE raffle_milestones
  ADD CONSTRAINT raffle_milestones_trigger_type_check
  CHECK (trigger_type IN ('percent_max', 'absolute_tickets', 'draw_threshold'));
