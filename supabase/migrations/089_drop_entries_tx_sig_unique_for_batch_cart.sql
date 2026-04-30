-- ============================================================================
-- Migration 089: Allow one on-chain signature on multiple confirmed entries (batch cart)
-- ============================================================================
-- Migration 027 added entries_transaction_signature_unique so one Solana signature
-- could only appear on one entry row. Cart checkout intentionally uses ONE payment tx
-- to confirm MULTIPLE pending rows; the second UPDATE ... transaction_signature = p_tx_sig
-- hit a unique violation → 500 from confirm_entry_with_tx (unmapped Postgres error).
-- Replay / double-spend protection remains via verified_transactions (composite PK on
-- tx_sig + entry_id from migration 088) and blockchain verification before confirm.

DROP INDEX IF EXISTS public.entries_transaction_signature_unique;

COMMENT ON COLUMN public.entries.transaction_signature IS
  'Solana signature that confirmed this entry. Multiple entries may share the same signature after a merged cart payout; uniqueness is enforced in verified_transactions.';
