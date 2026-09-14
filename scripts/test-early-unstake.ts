/**
 * Early unstake fee helpers + rev-share forfeiture for early_unstake nests.
 * Run: npx tsx scripts/test-early-unstake.ts
 */

import assert from 'node:assert/strict'
import {
  getEarlyUnstakeFeeLamports,
  getEarlyUnstakeFeeSol,
  getStakingPlatformFeeUnitLamportsForAction,
  formatEarlyUnstakeFeeLabel,
} from '../lib/nesting/staking-platform-fee'
import { isPositionEligibleForRevSharePeriod } from '../lib/nesting/gen-owl-rev-share-eligibility'
import type { StakingPositionRow } from '../lib/db/staking-positions'
import { LAMPORTS_PER_SOL } from '@solana/web3.js'

function check(name: string, cond: boolean) {
  assert.ok(cond, name)
  console.log('ok:', name)
}

// Default early fee is 0.2 SOL
const earlySol = getEarlyUnstakeFeeSol()
check('default early unstake fee is 0.2 SOL', Math.abs(earlySol - 0.2) < 1e-9)
check(
  'early fee lamports match SOL',
  getEarlyUnstakeFeeLamports() === Math.round(0.2 * LAMPORTS_PER_SOL)
)
check(
  'unit lamports for early_unstake uses early fee',
  getStakingPlatformFeeUnitLamportsForAction('early_unstake') === getEarlyUnstakeFeeLamports()
)
check(
  'unit lamports for unstake uses normal platform fee',
  getStakingPlatformFeeUnitLamportsForAction('unstake') !== getEarlyUnstakeFeeLamports() ||
    getEarlyUnstakeFeeLamports() === 0
)
check('early fee label mentions early leave', formatEarlyUnstakeFeeLabel().toLowerCase().includes('early'))

const base: StakingPositionRow = {
  id: '00000000-0000-4000-8000-000000000001',
  wallet_address: 'Wallet111111111111111111111111111111111',
  pool_id: '00000000-0000-4000-8000-000000000002',
  asset_identifier: 'Mint1111111111111111111111111111111111111',
  amount: 1,
  reward_rate_snapshot: 0.2,
  reward_rate_unit_snapshot: 'daily',
  reward_token_snapshot: 'OWL',
  staked_at: '2026-01-01T00:00:00.000Z',
  unlock_at: '2026-12-31T00:00:00.000Z',
  unstaked_at: null,
  claimed_rewards: 0,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
}

check(
  'active nest still eligible for open month when not early-unstaked',
  isPositionEligibleForRevSharePeriod(base, '2026-06')
)

const earlyLeft: StakingPositionRow = {
  ...base,
  status: 'unstaked',
  unstaked_at: '2026-06-15T12:00:00.000Z',
  early_unstake: true,
}

check(
  'early_unstake nest is never rev-share eligible',
  !isPositionEligibleForRevSharePeriod(earlyLeft, '2026-06')
)

check(
  'early_unstake also forfeits prior months (auto-recalc among remaining nests)',
  !isPositionEligibleForRevSharePeriod(earlyLeft, '2026-01')
)

const normalLeaveAfterMonth: StakingPositionRow = {
  ...base,
  status: 'unstaked',
  unstaked_at: '2026-07-02T00:00:00.000Z',
  early_unstake: false,
}

check(
  'normal leave after month-end still counts for that month',
  isPositionEligibleForRevSharePeriod(normalLeaveAfterMonth, '2026-06')
)

console.log('test-early-unstake: ok')
