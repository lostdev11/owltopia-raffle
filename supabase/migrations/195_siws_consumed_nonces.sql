-- SIWS nonce single-use store (API + service role only).
-- Keyed on the nonce payload random component; rows expire with the SIWS TTL window.

CREATE TABLE IF NOT EXISTS public.siws_consumed_nonces (
  nonce_id text PRIMARY KEY,
  wallet text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS siws_consumed_nonces_expires_at_idx
  ON public.siws_consumed_nonces (expires_at);

COMMENT ON TABLE public.siws_consumed_nonces IS
  'Consumed SIWS nonce ids (API + service role only). TTL cleanup via expires_at.';

ALTER TABLE public.siws_consumed_nonces ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.siws_consumed_nonces TO service_role;
