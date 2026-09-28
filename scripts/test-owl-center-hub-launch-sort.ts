/**
 * Unit tests for Owl Center hub launch ordering.
 * Run: npx tsx scripts/test-owl-center-hub-launch-sort.ts
 */
import assert from 'node:assert/strict'

import {
  compareOwlCenterHubLaunches,
  getOwlCenterHubLaunchBucket,
  partitionOwlCenterHubLaunches,
  sortOwlCenterHubLaunches,
} from '../lib/owl-center/hub-launch-sort'
import type { OwlCenterLaunchPublic } from '../lib/owl-center/types'

function stub(partial: Partial<OwlCenterLaunchPublic> & Pick<OwlCenterLaunchPublic, 'slug' | 'name'>): OwlCenterLaunchPublic {
  return {
    symbol: null,
    description: null,
    image_url: null,
    creator_wallet: null,
    candy_machine_id: null,
    collection_mint: null,
    devnet_candy_machine_id: null,
    devnet_collection_mint: null,
    mint_standard: 'core',
    onchain_update_authority: null,
    platform_update_delegate: null,
    total_supply: 100,
    minted_count: 0,
    active_phase: 'PUBLIC',
    active_phases: [],
    status: 'PUBLIC',
    presale_supply: 0,
    wl_supply: 0,
    public_supply: 100,
    airdrop_supply: 0,
    presale_overage_supply: 0,
    presale_price_usdc: null,
    wl_price_usdc: null,
    public_price_usdc: 1,
    wallet_mint_limit: 5,
    magic_eden_url: null,
    tensor_url: null,
    orbis_url: null,
    is_featured: false,
    is_paused: false,
    launch_deadline_at: null,
    phase_schedule: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    metadata_ready: true,
    assets_ready: true,
    marketplace_ready: false,
    treasury_wallet: null,
    royalty_splits: null,
    mint_fund_splits: null,
    creator_presale_enabled: false,
    creator_wl_enabled: false,
    creator_mint_price: null,
    creator_mint_currency: null,
    creator_launch_date: null,
    mint_mode: 'public_simple',
    mint_network: 'mainnet',
    generator_project_id: null,
    seller_fee_basis_points: 500,
    reveal_mode: null,
    reveal_status: 'disabled',
    reveal_at: null,
    reveal_completed_at: null,
    reveal_payment_tx_signature: null,
    placeholder_metadata_uri: null,
    reveal_progress: {},
    freeze_enabled: false,
    unfreeze_date: null,
    freeze_status: 'disabled',
    freeze_authority: null,
    freeze_thawed_at: null,
    freeze_progress: {},
    partner_allowlist_phases: [],
    platform_fee_rebate_bps: 0,
    platform_fee_rebate_wallet: null,
    id: partial.slug,
    ...partial,
  }
}

const olderLive = stub({
  slug: 'older-live',
  name: 'Older Live',
  created_at: '2026-01-01T00:00:00.000Z',
  creator_launch_date: '2026-01-01T12:00:00.000Z',
})
const newerLive = stub({
  slug: 'newer-live',
  name: 'Newer Live',
  created_at: '2026-06-01T00:00:00.000Z',
  creator_launch_date: '2026-06-15T12:00:00.000Z',
})
const soldOut = stub({
  slug: 'sold-out',
  name: 'Sold Out',
  active_phase: 'SOLD_OUT',
  status: 'SOLD_OUT',
  created_at: '2026-09-01T00:00:00.000Z',
})
const trading = stub({
  slug: 'trading',
  name: 'Trading',
  active_phase: 'TRADING_ACTIVE',
  created_at: '2026-08-01T00:00:00.000Z',
})

assert.equal(getOwlCenterHubLaunchBucket(olderLive), 'live')
assert.equal(getOwlCenterHubLaunchBucket(soldOut), 'sold_out')
assert.equal(getOwlCenterHubLaunchBucket(trading), 'trading')

assert.ok(compareOwlCenterHubLaunches(newerLive, olderLive) < 0)
assert.ok(compareOwlCenterHubLaunches(olderLive, soldOut) < 0)
assert.ok(compareOwlCenterHubLaunches(soldOut, trading) > 0)

const sorted = sortOwlCenterHubLaunches([soldOut, olderLive, trading, newerLive])
assert.deepEqual(
  sorted.map((l) => l.slug),
  ['newer-live', 'older-live', 'trading', 'sold-out']
)

const parts = partitionOwlCenterHubLaunches([soldOut, olderLive, trading, newerLive])
assert.deepEqual(
  parts.live.map((l) => l.slug),
  ['newer-live', 'older-live']
)
assert.deepEqual(parts.trading.map((l) => l.slug), ['trading'])
assert.deepEqual(parts.soldOut.map((l) => l.slug), ['sold-out'])

console.log('test-owl-center-hub-launch-sort: ok')
