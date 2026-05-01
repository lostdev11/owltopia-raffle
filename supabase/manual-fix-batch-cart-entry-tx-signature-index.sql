-- ============================================================================
-- Manual fix: allow ONE Solana signature on MULTIPLE entries (merged cart)
-- ============================================================================
-- Run in Supabase SQL Editor if migrations 089 / 092 were not applied.
-- Without this, confirm_cart_batch_with_tx fails with duplicate key on
-- entries.transaction_signature (23505).
--
-- Replay protection stays on verified_transactions (tx_sig + entry_id).

DROP INDEX IF EXISTS public.idx_entries_transaction_signature_unique;
DROP INDEX IF EXISTS public.entries_transaction_signature_unique;

COMMENT ON COLUMN public.entries.transaction_signature IS
  'Solana signature that confirmed this entry. Multiple entries may share the same signature after a merged cart payout; uniqueness is enforced in verified_transactions.';
