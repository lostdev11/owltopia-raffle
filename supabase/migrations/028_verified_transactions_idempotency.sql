-- ============================================================================
-- Migration 028: Verified transactions table (idempotency lock / replay protection)
-- ============================================================================
-- Inserting tx_sig first enforces single-use at DB level.
-- Duplicate INSERT → Postgres unique violation (23505).
-- Backend uses this before updating entries; enables safe retries (same entry + tx).
-- No RLS: table is backend-only (service role).

CREATE TABLE IF NOT EXISTS public.verified_transactions (
  tx_sig TEXT PRIMARY KEY,
  raffle_id UUID NOT NULL REFERENCES public.raffles(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  amount_paid NUMERIC NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verified_transactions_raffle_id
  ON public.verified_transactions (raffle_id);

CREATE INDEX IF NOT EXISTS idx_verified_transactions_wallet_address
  ON public.verified_transactions (wallet_address);

COMMENT ON TABLE public.verified_transactions IS 'Idempotency lock: one row per transaction signature. Prevents payment replay.';
