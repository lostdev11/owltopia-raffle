import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { isAdmin } from '@/lib/db/admins'
import {
  listPartnerNestApplicationsByWallet,
} from '@/lib/db/partner-nest-applications'
import {
  getStakingPoolById,
  partnerRewardAvailableUi,
  type StakingPoolRow,
} from '@/lib/db/staking-pools'
import { listPartnerNestRewardDepositsForPool } from '@/lib/db/partner-nest-reward-deposits'
import {
  getPartnerNestRewardVaultWallet,
  isPartnerTokenRewardPool,
} from '@/lib/nesting/partner-reward-vault'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

async function assertPartnerOwnsPool(
  wallet: string,
  pool: StakingPoolRow
): Promise<true | NextResponse> {
  const [feeTier, admin] = await Promise.all([
    getCreatorFeeTier(wallet, { skipCache: true }),
    isAdmin(wallet),
  ])
  if (admin) return true
  if (feeTier.reason !== 'partner_community') {
    return NextResponse.json({ error: 'Partner program access required.' }, { status: 403 })
  }
  const apps = await listPartnerNestApplicationsByWallet(wallet)
  const owns = apps.some((a) => a.status === 'active' && a.approved_pool_id === pool.id)
  if (!owns) {
    return NextResponse.json(
      { error: 'You can only fund Nesting reward pools created from your approved requests.' },
      { status: 403 }
    )
  }
  return true
}

/**
 * GET /api/partners/nest-rewards?pool_id= — vault address, balances, recent deposits.
 */
export async function GET(request: NextRequest) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  try {
    const poolId = request.nextUrl.searchParams.get('pool_id')?.trim() ?? ''
    if (!poolId || !STAKING_UUID_RE.test(poolId)) {
      return NextResponse.json({ error: 'Valid pool_id is required.' }, { status: 400 })
    }

    const pool = await getStakingPoolById(poolId)
    if (!pool) {
      return NextResponse.json({ error: 'Pool not found.' }, { status: 404 })
    }

    const access = await assertPartnerOwnsPool(session.wallet, pool)
    if (access instanceof NextResponse) return access

    if (!isPartnerTokenRewardPool(pool)) {
      return NextResponse.json(
        {
          error:
            'This nest pays OWL from Owltopia (no partner deposit needed). Partner token funding applies only to partner_token perches.',
        },
        { status: 400 }
      )
    }

    const vaultWallet = getPartnerNestRewardVaultWallet()
    if (!vaultWallet) {
      return NextResponse.json(
        {
          error:
            'Nesting reward vault is not configured. Set NESTING_OWL_REWARD_TREASURY_WALLET / SECRET_KEY.',
        },
        { status: 503 }
      )
    }

    const deposits = await listPartnerNestRewardDepositsForPool(poolId, 20)
    const funded = Number(pool.partner_reward_funded ?? 0)
    const paid = Number(pool.partner_reward_paid ?? 0)
    const available = partnerRewardAvailableUi(pool)

    return NextResponse.json({
      pool: {
        id: pool.id,
        name: pool.name,
        reward_token: pool.reward_token,
        reward_mint: pool.reward_mint,
        reward_decimals: pool.reward_decimals ?? null,
      },
      vault_wallet: vaultWallet,
      funded,
      paid,
      available,
      deposits,
    })
  } catch (e) {
    console.error('[partners/nest-rewards GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
