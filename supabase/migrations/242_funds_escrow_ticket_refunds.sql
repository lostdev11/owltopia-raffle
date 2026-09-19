-- Ticket refund ledger: durable history of funds-escrow ticket refunds for users + admin.
-- Writes via Next.js + service_role only (migration 020 pattern).

CREATE TABLE IF NOT EXISTS public.funds_escrow_ticket_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.entries(id) ON DELETE CASCADE,
  raffle_id uuid NOT NULL REFERENCES public.raffles(id) ON DELETE CASCADE,
  wallet_address text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'SOL',
  tx_signature text NOT NULL,
  refunded_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL
    CHECK (source IN (
      'buyer_claim',
      'admin_send',
      'auto_finalize',
      'auto_cron',
      'manual_record',
      'zero_payment',
      'legacy_backfill'
    )),
  actor_wallet text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT funds_escrow_ticket_refunds_entry_id_unique UNIQUE (entry_id)
);

CREATE INDEX IF NOT EXISTS idx_funds_escrow_ticket_refunds_wallet_refunded
  ON public.funds_escrow_ticket_refunds (wallet_address, refunded_at DESC);

CREATE INDEX IF NOT EXISTS idx_funds_escrow_ticket_refunds_raffle_refunded
  ON public.funds_escrow_ticket_refunds (raffle_id, refunded_at DESC);

CREATE INDEX IF NOT EXISTS idx_funds_escrow_ticket_refunds_refunded
  ON public.funds_escrow_ticket_refunds (refunded_at DESC);

COMMENT ON TABLE public.funds_escrow_ticket_refunds IS
  'Append-only ledger of ticket refunds from funds escrow. API + service_role only.';

ALTER TABLE public.funds_escrow_ticket_refunds ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.funds_escrow_ticket_refunds TO service_role;

-- Backfill already-refunded entries so history is complete for users.
INSERT INTO public.funds_escrow_ticket_refunds (
  entry_id,
  raffle_id,
  wallet_address,
  amount,
  currency,
  tx_signature,
  refunded_at,
  source,
  actor_wallet
)
SELECT
  e.id,
  e.raffle_id,
  e.wallet_address,
  coalesce(e.amount_paid, 0),
  upper(coalesce(nullif(trim(e.currency), ''), 'SOL')),
  coalesce(
    nullif(trim(e.refund_transaction_signature), ''),
    'legacy-missing-sig:' || e.id::text
  ),
  e.refunded_at,
  'legacy_backfill',
  NULL
FROM public.entries e
WHERE e.refunded_at IS NOT NULL
ON CONFLICT (entry_id) DO NOTHING;
