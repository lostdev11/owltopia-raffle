import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  insertStakingPool,
  listAllStakingPoolsAdmin,
  type StakingAssetType,
  type RewardRateUnit,
  type NestingAdapterMode,
  type LockEnforcementSource,
} from '@/lib/db/staking-pools'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

function isAssetType(v: unknown): v is StakingAssetType {
  return v === 'nft' || v === 'token'
}

function isRewardUnit(v: unknown): v is RewardRateUnit {
  return v === 'hourly' || v === 'daily' || v === 'weekly'
}

function isAdapterMode(v: unknown): v is NestingAdapterMode {
  return v === 'mock' || v === 'solana_ready' || v === 'onchain_enabled'
}

function isLockEnforcement(v: unknown): v is LockEnforcementSource {
  return v === 'database' || v === 'onchain' || v === 'hybrid'
}

/**
 * GET /api/admin/staking/pools — all pools (including inactive).
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const pools = await listAllStakingPoolsAdmin()
    return NextResponse.json({ pools })
  } catch (e) {
    console.error('[admin/staking/pools GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * POST /api/admin/staking/pools — create pool.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => null)
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : ''
    const description = typeof body?.description === 'string' ? body.description.trim() : ''
    if (!name || !slug || !description) {
      return NextResponse.json({ error: 'name, slug, and description are required' }, { status: 400 })
    }
    if (!isAssetType(body?.asset_type)) {
      return NextResponse.json({ error: 'asset_type must be nft or token' }, { status: 400 })
    }

    const reward_rate_unit = body?.reward_rate_unit
    const unit: RewardRateUnit = isRewardUnit(reward_rate_unit) ? reward_rate_unit : 'daily'

    const reward_rate = body.reward_rate !== undefined ? Number(body.reward_rate) : 0
    const lock_period_days = body.lock_period_days !== undefined ? Number(body.lock_period_days) : 0
    const platform_fee_bps = body.platform_fee_bps !== undefined ? Number(body.platform_fee_bps) : 0
    const display_order = body.display_order !== undefined ? Number(body.display_order) : 0
    if ([reward_rate, lock_period_days, platform_fee_bps, display_order].some((n) => Number.isNaN(n))) {
      return NextResponse.json({ error: 'Invalid numeric field' }, { status: 400 })
    }

    let minimum_stake: number | null = null
    let maximum_stake: number | null = null
    if (body.minimum_stake !== undefined && body.minimum_stake !== null) {
      minimum_stake = Number(body.minimum_stake)
      if (Number.isNaN(minimum_stake)) {
        return NextResponse.json({ error: 'Invalid minimum_stake' }, { status: 400 })
      }
    }
    if (body.maximum_stake !== undefined && body.maximum_stake !== null) {
      maximum_stake = Number(body.maximum_stake)
      if (Number.isNaN(maximum_stake)) {
        return NextResponse.json({ error: 'Invalid maximum_stake' }, { status: 400 })
      }
    }

    const adapter_mode =
      body?.adapter_mode !== undefined && isAdapterMode(body.adapter_mode)
        ? body.adapter_mode
        : undefined

    const lock_enforcement_source =
      body?.lock_enforcement_source !== undefined && isLockEnforcement(body.lock_enforcement_source)
        ? body.lock_enforcement_source
        : undefined

    const pool = await insertStakingPool({
      name,
      slug,
      description,
      asset_type: body.asset_type,
      token_mint: body.token_mint ?? null,
      collection_key: body.collection_key ?? null,
      reward_token: body.reward_token ?? null,
      reward_rate,
      reward_rate_unit: unit,
      lock_period_days,
      minimum_stake,
      maximum_stake,
      platform_fee_bps,
      is_active: body.is_active !== undefined ? Boolean(body.is_active) : true,
      display_order,
      partner_project_slug: body.partner_project_slug ?? null,
      created_by: session.wallet,
      adapter_mode,
      is_onchain_enabled:
        body?.is_onchain_enabled !== undefined ? Boolean(body.is_onchain_enabled) : undefined,
      program_id: body?.program_id ?? null,
      program_pool_address: body?.program_pool_address ?? null,
      vault_address: body?.vault_address ?? null,
      stake_mint: body?.stake_mint ?? null,
      reward_mint: body?.reward_mint ?? null,
      requires_onchain_sync:
        body?.requires_onchain_sync !== undefined ? Boolean(body.requires_onchain_sync) : undefined,
      lock_enforcement_source,
    })

    return NextResponse.json({ pool })
  } catch (e) {
    console.error('[admin/staking/pools POST]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
