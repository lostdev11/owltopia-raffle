import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getStakingPoolById,
  updateStakingPool,
  type PatchStakingPoolInput,
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

type RouteContext = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/staking/pools/[id]
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const { id } = await context.params
    const pool = await getStakingPoolById(id)
    if (!pool) {
      return NextResponse.json({ error: 'Pool not found' }, { status: 404 })
    }
    return NextResponse.json({ pool })
  } catch (e) {
    console.error('[admin/staking/pools/[id] GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * PATCH /api/admin/staking/pools/[id]
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const { id } = await context.params
    const existing = await getStakingPoolById(id)
    if (!existing) {
      return NextResponse.json({ error: 'Pool not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const patch: PatchStakingPoolInput = {}

    if (body?.name !== undefined) patch.name = String(body.name)
    if (body?.slug !== undefined) patch.slug = String(body.slug)
    if (body?.description !== undefined) patch.description = String(body.description)
    if (body?.asset_type !== undefined) {
      if (!isAssetType(body.asset_type)) {
        return NextResponse.json({ error: 'asset_type must be nft or token' }, { status: 400 })
      }
      patch.asset_type = body.asset_type
    }
    if (body?.token_mint !== undefined) patch.token_mint = body.token_mint
    if (body?.collection_key !== undefined) patch.collection_key = body.collection_key
    if (body?.reward_token !== undefined) patch.reward_token = body.reward_token
    if (body?.reward_rate !== undefined) patch.reward_rate = Number(body.reward_rate)
    if (body?.reward_rate_unit !== undefined) {
      if (!isRewardUnit(body.reward_rate_unit)) {
        return NextResponse.json({ error: 'invalid reward_rate_unit' }, { status: 400 })
      }
      patch.reward_rate_unit = body.reward_rate_unit
    }
    if (body?.lock_period_days !== undefined) patch.lock_period_days = Number(body.lock_period_days)
    if (body?.minimum_stake !== undefined) {
      patch.minimum_stake = body.minimum_stake === null ? null : Number(body.minimum_stake)
    }
    if (body?.maximum_stake !== undefined) {
      patch.maximum_stake = body.maximum_stake === null ? null : Number(body.maximum_stake)
    }
    if (body?.platform_fee_bps !== undefined) patch.platform_fee_bps = Number(body.platform_fee_bps)
    if (body?.is_active !== undefined) patch.is_active = Boolean(body.is_active)
    if (body?.display_order !== undefined) patch.display_order = Number(body.display_order)
    if (body?.partner_project_slug !== undefined) patch.partner_project_slug = body.partner_project_slug
    if (body?.adapter_mode !== undefined) {
      if (!isAdapterMode(body.adapter_mode)) {
        return NextResponse.json({ error: 'invalid adapter_mode' }, { status: 400 })
      }
      patch.adapter_mode = body.adapter_mode
    }
    if (body?.is_onchain_enabled !== undefined) patch.is_onchain_enabled = Boolean(body.is_onchain_enabled)
    if (body?.program_id !== undefined) patch.program_id = body.program_id
    if (body?.program_pool_address !== undefined) patch.program_pool_address = body.program_pool_address
    if (body?.vault_address !== undefined) patch.vault_address = body.vault_address
    if (body?.stake_mint !== undefined) patch.stake_mint = body.stake_mint
    if (body?.reward_mint !== undefined) patch.reward_mint = body.reward_mint
    if (body?.requires_onchain_sync !== undefined) {
      patch.requires_onchain_sync = Boolean(body.requires_onchain_sync)
    }
    if (body?.lock_enforcement_source !== undefined) {
      if (!isLockEnforcement(body.lock_enforcement_source)) {
        return NextResponse.json({ error: 'invalid lock_enforcement_source' }, { status: 400 })
      }
      patch.lock_enforcement_source = body.lock_enforcement_source
    }

    const pool = await updateStakingPool(id, patch)
    return NextResponse.json({ pool })
  } catch (e) {
    console.error('[admin/staking/pools/[id] PATCH]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
