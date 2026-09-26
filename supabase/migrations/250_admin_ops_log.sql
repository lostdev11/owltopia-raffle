-- Admin Ops Log: manual money moves, refunds, payouts, incidents (Owl Vision).
-- API + service_role only — junior (mod) and full admins via Next.js session checks.

CREATE TABLE IF NOT EXISTS public.admin_ops_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL
    CHECK (type IN (
      'refund',
      'prize_payout',
      'top_up',
      'mis_send',
      'incident',
      'fee_refund',
      'other'
    )),
  title text NOT NULL,
  who text NULL,
  wallet text NULL,
  amount numeric NULL,
  asset text NULL
    CHECK (asset IS NULL OR asset IN ('SOL', 'OWL', 'USDC', 'NFT', 'other')),
  from_wallet text NULL,
  tx_signature text NULL,
  related text NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'lost', 'needs_decision')),
  notes text NULL,
  created_by_wallet text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_wallet text NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_ops_log_occurred_at
  ON public.admin_ops_log (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_ops_log_status
  ON public.admin_ops_log (status);

CREATE INDEX IF NOT EXISTS idx_admin_ops_log_type_occurred
  ON public.admin_ops_log (type, occurred_at DESC);

DROP TRIGGER IF EXISTS update_admin_ops_log_updated_at ON public.admin_ops_log;
CREATE TRIGGER update_admin_ops_log_updated_at
  BEFORE UPDATE ON public.admin_ops_log
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.admin_ops_log IS
  'Internal ledger of manual treasury/support money moves and incidents. Owl Vision API + service_role only.';

ALTER TABLE public.admin_ops_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_ops_log_deny_all ON public.admin_ops_log;
CREATE POLICY admin_ops_log_deny_all ON public.admin_ops_log
  FOR ALL USING (false) WITH CHECK (false);

REVOKE ALL ON TABLE public.admin_ops_log FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_ops_log FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.admin_ops_log TO service_role;
