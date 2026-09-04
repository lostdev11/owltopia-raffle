-- =============================================================================
-- Audit: VRF metadata written after winner selection (concurrent draw race)
-- =============================================================================
-- Run in Supabase SQL Editor. Rows here had correct draws (verify-draw ok) but
-- stored Switchboard request/fulfill txs may point at the wrong randomness account.
--
-- After deploy of the patchVrfFields guard, new raffles should not appear here.

SELECT
  r.id,
  r.slug,
  r.title,
  r.status,
  r.winner_wallet,
  r.winner_selected_at,
  r.draw_vrf_requested_at,
  r.draw_vrf_fulfilled_at,
  r.draw_revealed_at,
  EXTRACT(EPOCH FROM (r.draw_vrf_requested_at - r.winner_selected_at)) AS vrf_after_winner_seconds,
  r.draw_vrf_account,
  r.draw_vrf_request_tx,
  r.draw_vrf_fulfill_tx,
  left(r.draw_seed, 16) AS seed_prefix
FROM public.raffles r
WHERE r.draw_algo = 'owltopia-draw-v3-vrf'
  AND r.winner_selected_at IS NOT NULL
  AND r.draw_vrf_requested_at IS NOT NULL
  AND r.draw_vrf_requested_at > r.winner_selected_at
ORDER BY r.winner_selected_at DESC;
