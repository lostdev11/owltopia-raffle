-- ============================================================================
-- Migration 091: Allow service_role to call confirm_cart_batch_with_tx
-- ============================================================================
-- Migration 090 defined the RPC but did not GRANT EXECUTE. On some Postgres /
-- Supabase setups only the owner can run new functions; PostgREST then returns
-- permission denied → verify-batch 500. Align with other atomic RPCs (e.g. 057, 075).

GRANT EXECUTE ON FUNCTION public.confirm_cart_batch_with_tx(TEXT, TEXT, UUID[]) TO service_role;
