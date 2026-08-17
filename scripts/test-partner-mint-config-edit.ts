import assert from 'node:assert/strict'
import { buildMintDetailsPatchFromBody } from '@/lib/owl-center/launch-mint-config-patch'
import type { OwlCenterLaunchPublic } from '@/lib/owl-center/types'

function baseLaunch(overrides: Partial<OwlCenterLaunchPublic> = {}): OwlCenterLaunchPublic {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'sub-test',
    name: 'Test',
    symbol: 'TST',
    description: null,
    image_url: null,
    mint_standard: 'core',
    total_supply: 5,
    minted_count: 0,
    active_phase: 'PUBLIC',
    active_phases: [],
    status: 'PENDING_REVIEW',
    presale_supply: 0,
    wl_supply: 0,
    public_supply: 5,
    airdrop_supply: 0,
    presale_overage_supply: 0,
    presale_price_usdc: null,
    wl_price_usdc: null,
    public_price_usdc: null,
    wallet_mint_limit: 5,
    magic_eden_url: null,
    tensor_url: null,
    orbis_url: null,
    is_featured: false,
    is_paused: true,
    launch_deadline_at: null,
    phase_schedule: {},
    candy_machine_id: null,
    collection_mint: null,
    devnet_candy_machine_id: null,
    devnet_collection_mint: null,
    mint_mode: 'public_simple',
    mint_network: 'mainnet',
    creator_wallet: 'Creator1111111111111111111111111111111111111',
    treasury_wallet: 'Creator1111111111111111111111111111111111111',
    royalty_splits: [{ address: 'Creator1111111111111111111111111111111111111', share: 100 }],
    mint_fund_splits: [{ address: 'Creator1111111111111111111111111111111111111', share: 100 }],
    seller_fee_basis_points: 500,
    creator_presale_enabled: false,
    creator_wl_enabled: false,
    creator_mint_price: 0,
    creator_mint_currency: 'SOL',
    creator_launch_date: null,
    assets_ready: false,
    metadata_ready: false,
    marketplace_ready: false,
    generator_project_id: null,
    reveal_mode: null,
    reveal_status: 'disabled',
    reveal_at: null,
    reveal_completed_at: null,
    reveal_payment_tx_signature: null,
    placeholder_metadata_uri: null,
    reveal_progress: null,
    freeze_enabled: false,
    unfreeze_date: null,
    freeze_status: 'disabled',
    freeze_authority: null,
    freeze_thawed_at: null,
    freeze_progress: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as OwlCenterLaunchPublic
}

const unlocked = buildMintDetailsPatchFromBody(
  {
    total_supply: 222,
    mint_standard: 'core',
    public_price: '0',
    currency: 'SOL',
    wallet_mint_limit: 5,
    royalty_percent: 5,
  },
  baseLaunch()
)
assert.ok(!('error' in unlocked), 'unlocked supply edit should succeed')
assert.equal(unlocked.total_supply, 222)
assert.equal(unlocked.public_supply, 222)
assert.equal(unlocked.mint_standard, 'core')

const locked = buildMintDetailsPatchFromBody(
  { total_supply: 222, mint_standard: 'core', public_price: '1', currency: 'SOL', wallet_mint_limit: 5 },
  baseLaunch({ candy_machine_id: 'Cm11111111111111111111111111111111111111111', total_supply: 5 })
)
assert.ok('error' in locked, 'supply change should fail when CM exists')
assert.match(String(locked.error), /locked/i)

console.log('ok: partner mint-config supply/core patch locks')
