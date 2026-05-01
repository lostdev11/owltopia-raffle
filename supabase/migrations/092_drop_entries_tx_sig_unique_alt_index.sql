-- ============================================================================
-- Migration 092: Drop alternate unique index name on entries.transaction_signature
-- ============================================================================
-- Some databases created public.idx_entries_transaction_signature_unique (e.g.
-- manual / tooling) while 089 only dropped entries_transaction_signature_unique.
-- Both enforce "one row per signature" and break confirm_cart_batch_with_tx.

DROP INDEX IF EXISTS public.idx_entries_transaction_signature_unique;
DROP INDEX IF EXISTS public.entries_transaction_signature_unique;
