/**
 * Creator Manage collection setup checklist (Phase A).
 * Run: npx tsx scripts/test-creator-launch-setup-checklist.ts
 */
import assert from 'node:assert/strict'

import {
  buildCreatorLaunchSetupChecklist,
  creatorSetupChecklistProgress,
} from '../lib/owl-center/creator-launch-setup-checklist'
import type { OwlCenterLaunchPublic } from '../lib/owl-center/types'

function launch(
  overrides: Partial<OwlCenterLaunchPublic> = {}
): OwlCenterLaunchPublic {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'demo',
    name: 'Demo',
    symbol: 'DEMO',
    description: null,
    image_url: null,
    creator_wallet: 'Creator111111111111111111111111111111111',
    candy_machine_id: null,
    collection_mint: null,
    devnet_candy_machine_id: null,
    devnet_collection_mint: null,
    mint_standard: 'core',
    total_supply: 222,
    minted_count: 0,
    active_phase: 'PUBLIC',
    active_phases: [],
    status: 'PENDING_REVIEW',
    presale_supply: 0,
    wl_supply: 0,
    public_supply: 222,
    airdrop_supply: 0,
    presale_overage_supply: 0,
    presale_price_usdc: null,
    wl_price_usdc: null,
    public_price_usdc: null,
    wallet_mint_limit: 5,
    magic_eden_url: null,
    tensor_url: null,
    is_featured: false,
    is_paused: true,
    launch_deadline_at: null,
    phase_schedule: {},
    updated_at: new Date().toISOString(),
    metadata_ready: false,
    assets_ready: false,
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
    ...overrides,
  } as OwlCenterLaunchPublic
}

const empty = buildCreatorLaunchSetupChecklist({ launch: launch() })
assert.equal(empty.find((s) => s.id === 'mint-details')?.status, 'todo')
assert.equal(empty.find((s) => s.id === 'allowlist')?.status, 'skipped')
assert.equal(empty.find((s) => s.id === 'wallets')?.status, 'skipped')
assert.equal(empty.find((s) => s.id === 'trading')?.status, 'skipped')

const basics = buildCreatorLaunchSetupChecklist({
  launch: launch({
    creator_mint_price: 1,
    creator_mint_currency: 'SOL',
    launch_deadline_at: '2026-08-24T12:00:00.000Z',
    freeze_enabled: true,
    freeze_status: 'pending',
  }),
})
assert.equal(basics.find((s) => s.id === 'mint-details')?.status, 'done')
assert.equal(basics.find((s) => s.id === 'trading')?.status, 'todo')

const withWl = buildCreatorLaunchSetupChecklist({
  launch: launch({
    creator_mint_price: 1,
    creator_mint_currency: 'SOL',
    phase_schedule: { PUBLIC: '2026-08-26T12:00:00.000Z' },
    partner_allowlist_phases: [
      {
        key: 'og',
        label: 'OG',
        starts_at: '2026-08-20T12:00:00.000Z',
        supply: 50,
        price_usdc: 15,
      },
    ],
  }),
  allowlistWalletCount: 0,
})
assert.equal(withWl.find((s) => s.id === 'allowlist')?.status, 'done')
assert.equal(withWl.find((s) => s.id === 'wallets')?.status, 'todo')

const walletsDone = buildCreatorLaunchSetupChecklist({
  launch: withWl[0] && launch({
    creator_mint_price: 1,
    creator_mint_currency: 'SOL',
    phase_schedule: { PUBLIC: '2026-08-26T12:00:00.000Z' },
    partner_allowlist_phases: [
      {
        key: 'og',
        label: 'OG',
        starts_at: '2026-08-20T12:00:00.000Z',
        supply: 50,
        price_usdc: 15,
      },
    ],
  }),
  allowlistWalletCount: 12,
})
assert.equal(walletsDone.find((s) => s.id === 'wallets')?.status, 'done')

const live = buildCreatorLaunchSetupChecklist({
  launch: launch({
    creator_mint_price: 1,
    creator_mint_currency: 'SOL',
    launch_deadline_at: '2026-08-24T12:00:00.000Z',
    status: 'PUBLIC',
    active_phase: 'PUBLIC',
    is_paused: false,
    candy_machine_id: 'Candy1111111111111111111111111111111111111',
    freeze_enabled: true,
    freeze_status: 'pending',
    minted_count: 10,
  }),
})
assert.equal(live.find((s) => s.id === 'share')?.status, 'done')
assert.equal(live.find((s) => s.id === 'trading')?.status, 'waiting')

const unlocked = buildCreatorLaunchSetupChecklist({
  launch: launch({
    creator_mint_price: 1,
    creator_mint_currency: 'SOL',
    launch_deadline_at: '2026-08-24T12:00:00.000Z',
    freeze_enabled: true,
    freeze_status: 'thawed',
  }),
})
assert.equal(unlocked.find((s) => s.id === 'trading')?.status, 'done')

const progress = creatorSetupChecklistProgress(basics)
assert.ok(progress.requiredTotal >= 2)
assert.ok(progress.requiredDone >= 1)

console.log('ok — creator launch setup checklist')
