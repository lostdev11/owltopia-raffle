-- Commit–reveal draw (v2): public SHA-256(seed) at raffle create; raw seed revealed at draw.
-- Raw seed lives in raffle_draw_secrets (service_role only) — never on raffles (anon SELECT *).

ALTER TABLE public.raffles
  ADD COLUMN IF NOT EXISTS draw_commit_hash text,
  ADD COLUMN IF NOT EXISTS draw_committed_at timestamptz;

COMMENT ON COLUMN public.raffles.draw_commit_hash IS
  'Public SHA-256 hex of the draw seed (committed at create for owltopia-draw-v2-commit-reveal)';
COMMENT ON COLUMN public.raffles.draw_committed_at IS
  'When draw_commit_hash was published';

CREATE TABLE IF NOT EXISTS public.raffle_draw_secrets (
  raffle_id uuid PRIMARY KEY REFERENCES public.raffles (id) ON DELETE CASCADE,
  seed_hex text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.raffle_draw_secrets IS
  'Pre-draw draw seeds (API + service role only). Deleted after reveal. Never grant anon/authenticated.';

COMMENT ON COLUMN public.raffle_draw_secrets.seed_hex IS
  '32-byte hex draw seed; must satisfy sha256(seed_hex) = raffles.draw_commit_hash';

ALTER TABLE public.raffle_draw_secrets ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.raffle_draw_secrets TO service_role;
