-- ============================================================================
-- 073: Owl Council — proposals and votes (Supabase-only; no on-chain coupling)
-- Writes from app use service role via API routes (see migration 020 pattern).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.owl_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'ended', 'archived')),
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT owl_proposals_slug_unique UNIQUE (slug),
  CONSTRAINT owl_proposals_end_after_start CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_owl_proposals_status ON public.owl_proposals (status);
CREATE INDEX IF NOT EXISTS idx_owl_proposals_start_time ON public.owl_proposals (start_time);
CREATE INDEX IF NOT EXISTS idx_owl_proposals_end_time ON public.owl_proposals (end_time);

DROP TRIGGER IF EXISTS update_owl_proposals_updated_at ON public.owl_proposals;
CREATE TRIGGER update_owl_proposals_updated_at
  BEFORE UPDATE ON public.owl_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.owl_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id UUID NOT NULL REFERENCES public.owl_proposals (id) ON DELETE CASCADE,
  wallet_address TEXT NOT NULL,
  vote_choice TEXT NOT NULL CHECK (vote_choice IN ('yes', 'no', 'abstain')),
  voting_power NUMERIC NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT owl_votes_proposal_wallet_unique UNIQUE (proposal_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_owl_votes_proposal_id ON public.owl_votes (proposal_id);
CREATE INDEX IF NOT EXISTS idx_owl_votes_wallet_address ON public.owl_votes (wallet_address);

ALTER TABLE public.owl_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owl_votes ENABLE ROW LEVEL SECURITY;

-- Public read for non-draft proposals (drafts visible only via service role in API).
DROP POLICY IF EXISTS "Public can read published owl proposals" ON public.owl_proposals;
CREATE POLICY "Public can read published owl proposals"
  ON public.owl_proposals
  FOR SELECT
  TO anon, authenticated
  USING (status IN ('active', 'ended', 'archived'));

-- No policies on owl_votes: anon/authenticated denied; service_role bypasses RLS for aggregates/API writes.

GRANT SELECT ON public.owl_proposals TO anon, authenticated;

COMMENT ON TABLE public.owl_proposals IS 'Owl Council governance proposals; mutations via Next.js API + service role.';
COMMENT ON TABLE public.owl_votes IS 'Council votes; inserts and aggregates via Next.js API + service role only.';
COMMENT ON COLUMN public.owl_votes.voting_power IS 'MVP default 1; future weighted voting via DB snapshots/cache (no live RPC).';
