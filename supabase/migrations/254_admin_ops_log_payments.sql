-- Multiple payments per Ops Log entry (batch refunds, staged payouts).
-- API + service_role only — same access pattern as admin_ops_log.

CREATE TABLE IF NOT EXISTS public.admin_ops_log_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES public.admin_ops_log (id) ON DELETE CASCADE,
  amount numeric NULL,
  asset text NULL
    CHECK (asset IS NULL OR asset IN ('SOL', 'OWL', 'USDC', 'NFT', 'other')),
  from_wallet text NULL,
  to_wallet text NULL,
  tx_signature text NULL,
  related_pack_open_id text NULL,
  note text NULL,
  created_by_wallet text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_ops_log_payments_entry_id
  ON public.admin_ops_log_payments (entry_id);

CREATE INDEX IF NOT EXISTS idx_admin_ops_log_payments_tx_signature
  ON public.admin_ops_log_payments (tx_signature)
  WHERE tx_signature IS NOT NULL AND btrim(tx_signature) <> '';

COMMENT ON TABLE public.admin_ops_log_payments IS
  'Individual treasury txs tied to one admin_ops_log entry. Owl Vision API + service_role only.';

ALTER TABLE public.admin_ops_log_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_ops_log_payments_deny_all ON public.admin_ops_log_payments;
CREATE POLICY admin_ops_log_payments_deny_all ON public.admin_ops_log_payments
  FOR ALL USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.admin_ops_log_payments FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_ops_log_payments FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_ops_log_payments TO service_role;

-- Backfill one payment row per legacy entry that logged amount or an on-chain signature.
INSERT INTO public.admin_ops_log_payments (
  entry_id,
  amount,
  asset,
  from_wallet,
  to_wallet,
  tx_signature,
  created_by_wallet,
  created_at
)
SELECT
  l.id,
  l.amount,
  l.asset,
  l.from_wallet,
  l.wallet,
  NULLIF(btrim(l.tx_signature), ''),
  l.created_by_wallet,
  l.created_at
FROM public.admin_ops_log l
WHERE l.amount IS NOT NULL
   OR (
     l.tx_signature IS NOT NULL
     AND btrim(l.tx_signature) <> ''
     AND length(btrim(l.tx_signature)) >= 32
   );
