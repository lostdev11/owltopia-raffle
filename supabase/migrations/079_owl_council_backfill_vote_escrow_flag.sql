-- Legacy owl_votes rows created before migration 077 got council_vote_used_escrow = false by default.
-- Those ballots still used escrow-backed weight once council escrow voting was enabled, but withdrawals
-- looked “unlocked” because the flag stayed false. Backfill for votes on proposals whose voting window
-- is still open so lock math matches My vote / stake UI.

UPDATE public.owl_votes v
SET council_vote_used_escrow = true
FROM public.owl_proposals p
WHERE v.proposal_id = p.id
  AND v.council_vote_used_escrow = false
  AND p.status = 'active'
  AND now() >= p.start_time
  AND now() <= p.end_time
  AND COALESCE(v.voting_power, 0::numeric) > 0;
