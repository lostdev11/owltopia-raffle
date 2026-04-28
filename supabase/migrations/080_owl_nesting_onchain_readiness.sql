-- ============================================================================
-- 080: Owl Nesting — on-chain readiness metadata + sync columns (no program).
-- Existing pools/positions keep mock behavior: adapter_mode defaults to mock,
-- sync_status defaults to synced for DB-backed positions.
-- ============================================================================

-- Pool-level adapter & program wiring (nullable until configured)
ALTER TABLE public.staking_pools
  ADD COLUMN IF NOT EXISTS adapter_mode TEXT NOT NULL DEFAULT 'mock',
  ADD COLUMN IF NOT EXISTS is_onchain_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS program_id TEXT,
  ADD COLUMN IF NOT EXISTS program_pool_address TEXT,
  ADD COLUMN IF NOT EXISTS vault_address TEXT,
  ADD COLUMN IF NOT EXISTS stake_mint TEXT,
  ADD COLUMN IF NOT EXISTS reward_mint TEXT,
  ADD COLUMN IF NOT EXISTS requires_onchain_sync BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lock_enforcement_source TEXT NOT NULL DEFAULT 'database';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staking_pools_adapter_mode_check'
  ) THEN
    ALTER TABLE public.staking_pools
      ADD CONSTRAINT staking_pools_adapter_mode_check
      CHECK (adapter_mode IN ('mock', 'solana_ready', 'onchain_enabled'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staking_pools_lock_enforcement_check'
  ) THEN
    ALTER TABLE public.staking_pools
      ADD CONSTRAINT staking_pools_lock_enforcement_check
      CHECK (lock_enforcement_source IN ('database', 'onchain', 'hybrid'));
  END IF;
END $$;

COMMENT ON COLUMN public.staking_pools.adapter_mode IS 'mock | solana_ready | onchain_enabled — selects execution path in app layer.';
COMMENT ON COLUMN public.staking_pools.program_pool_address IS 'On-chain pool/state account pubkey (base58) when wired.';
COMMENT ON COLUMN public.staking_pools.stake_mint IS 'Optional SPL mint for staked asset; falls back to token_mint when null.';
COMMENT ON COLUMN public.staking_pools.reward_mint IS 'Optional SPL mint for rewards; reward_token may remain a display label.';

-- Position-level sync & tx audit (Sparse RPC: verify known signatures only.)
ALTER TABLE public.staking_positions
  ADD COLUMN IF NOT EXISTS onchain_position_address TEXT,
  ADD COLUMN IF NOT EXISTS stake_signature TEXT,
  ADD COLUMN IF NOT EXISTS unstake_signature TEXT,
  ADD COLUMN IF NOT EXISTS last_claim_signature TEXT,
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_transaction_error TEXT,
  ADD COLUMN IF NOT EXISTS external_reference TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'staking_positions_sync_status_check'
  ) THEN
    ALTER TABLE public.staking_positions
      ADD CONSTRAINT staking_positions_sync_status_check
      CHECK (sync_status IN ('pending', 'confirmed', 'failed', 'stale', 'synced'));
  END IF;
END $$;

COMMENT ON COLUMN public.staking_positions.sync_status IS 'synced = DB read model matches last known state; pending/failed for on-chain reconciliation.';
COMMENT ON COLUMN public.staking_positions.external_reference IS 'Opaque program-specific id (e.g. position seed index) when on-chain.';

ALTER TABLE public.staking_reward_events
  ADD COLUMN IF NOT EXISTS transaction_signature TEXT;

COMMENT ON COLUMN public.staking_reward_events.transaction_signature IS 'Solana signature for this claim when execution is on-chain.';
