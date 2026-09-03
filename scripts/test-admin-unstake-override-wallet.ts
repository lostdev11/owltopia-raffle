/**
 * Admin force-leave-by-wallet candidate selection + batch runner (no DB).
 * Run: npx tsx scripts/test-admin-unstake-override-wallet.ts
 */
import assert from 'node:assert/strict'
import type { StakingPositionRow } from '../lib/db/staking-positions'
import type { StakingPoolRow } from '../lib/db/staking-pools'
import {
  runAdminOverrideUnstakeBatch,
  selectAdminOverrideUnstakeCandidates,
} from '../lib/nesting/admin-unstake-override-select'
import { StakingUserError } from '../lib/nesting/errors'

const WALLET = 'AnyWallet1111111111111111111111111111111111'
const NOW = '2026-05-19T12:00:00.000Z'

function mockPos(
  overrides: Partial<StakingPositionRow> & Pick<StakingPositionRow, 'id' | 'status'>
): StakingPositionRow {
  return {
    wallet_address: WALLET,
    pool_id: 'pool-nft',
    asset_identifier: `mint-${overrides.id}`,
    amount: 1,
    reward_rate_snapshot: 1,
    reward_rate_unit_snapshot: 'daily',
    reward_token_snapshot: 'OWL',
    staked_at: NOW,
    unlock_at: null,
    unstaked_at: null,
    claimed_rewards: 0,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  }
}

type PoolShape = Pick<StakingPoolRow, 'asset_type' | 'adapter_mode' | 'name' | 'slug'>

const nftPool: PoolShape = {
  asset_type: 'nft',
  adapter_mode: 'onchain_enabled',
  name: 'Gen NFT',
  slug: 'gen-nft',
}
const tokenPool: PoolShape = {
  asset_type: 'token',
  adapter_mode: 'mock',
  name: 'OWL nest',
  slug: 'owl',
}

{
  const pools = new Map<string, PoolShape>([
    ['pool-nft', nftPool],
    ['pool-token', tokenPool],
  ])
  const positions = [
    mockPos({ id: 'active-1', status: 'active', staked_at: '2026-05-10T00:00:00.000Z' }),
    mockPos({
      id: 'pending-abort',
      status: 'pending',
      external_reference: 'awaiting_nft_freeze',
      staked_at: '2026-05-11T00:00:00.000Z',
    }),
    mockPos({
      id: 'pending-frozen',
      status: 'pending',
      external_reference: 'nft_freeze_confirmed:sig',
      staked_at: '2026-05-12T00:00:00.000Z',
    }),
    mockPos({ id: 'closed', status: 'unstaked', staked_at: '2026-05-01T00:00:00.000Z' }),
    mockPos({
      id: 'token-active',
      status: 'active',
      pool_id: 'pool-token',
      asset_identifier: null,
      amount: 100,
      staked_at: '2026-05-09T00:00:00.000Z',
    }),
  ]

  const selected = selectAdminOverrideUnstakeCandidates(positions, pools)
  assert.deepEqual(
    selected.map((c) => c.position_id),
    ['token-active', 'active-1', 'pending-abort'],
    'oldest eligible first; skip closed + freeze-confirmed pending'
  )
  assert.equal(selected[0]?.pool_slug, 'owl')
  assert.equal(selected[2]?.status, 'pending')
}

{
  const pools = new Map<string, PoolShape>([['pool-nft', { ...nftPool, adapter_mode: 'mock' }]])
  const positions = [
    mockPos({
      id: 'pending-opening',
      status: 'pending',
      external_reference: 'some-sig',
      staked_at: NOW,
    }),
  ]
  const selected = selectAdminOverrideUnstakeCandidates(positions, pools)
  assert.equal(selected.length, 0, 'non-awaiting pending on mock adapter is not abortable')
}

{
  const pools = new Map<string, PoolShape>([['pool-nft', { ...nftPool, adapter_mode: 'mock' }]])
  const positions = [
    mockPos({
      id: 'awaiting',
      status: 'pending',
      external_reference: 'awaiting_nft_freeze',
      staked_at: NOW,
    }),
  ]
  const selected = selectAdminOverrideUnstakeCandidates(positions, pools)
  assert.equal(selected.length, 1, 'awaiting_nft_freeze is abortable even on mock adapter')
}

async function testBatchRunner() {
  const candidates = [
    {
      position_id: 'a',
      pool_id: 'p',
      pool_name: 'P',
      pool_slug: 'p',
      status: 'active' as const,
      asset_identifier: 'm1',
      amount: 1,
      staked_at: '2026-05-01T00:00:00.000Z',
    },
    {
      position_id: 'b',
      pool_id: 'p',
      pool_name: 'P',
      pool_slug: 'p',
      status: 'active' as const,
      asset_identifier: 'm2',
      amount: 1,
      staked_at: '2026-05-02T00:00:00.000Z',
    },
    {
      position_id: 'c',
      pool_id: 'p',
      pool_name: 'P',
      pool_slug: 'p',
      status: 'active' as const,
      asset_identifier: 'm3',
      amount: 1,
      staked_at: '2026-05-03T00:00:00.000Z',
    },
  ]

  const result = await runAdminOverrideUnstakeBatch({
    wallet: WALLET,
    candidates,
    limit: 2,
    unstakeOne: async (id) => {
      if (id === 'a') throw new StakingUserError('boom', 400)
      return { position: { unstake_signature: id === 'b' ? 'sig-b' : null } }
    },
  })

  assert.equal(result.attempted, 2)
  assert.equal(result.closed.length, 1)
  assert.equal(result.closed[0]?.position_id, 'b')
  assert.equal(result.closed[0]?.execution_path, 'onchain_token_transfer')
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0]?.position_id, 'a')
  assert.equal(result.remaining_eligible, 2, 'failed + not-attempted remain eligible')
  assert.equal(result.eligible_total, 3)
}

void testBatchRunner().then(() => {
  console.log('admin-unstake-override-wallet: ok')
})
