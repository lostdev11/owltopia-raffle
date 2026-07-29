import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getCreatorFeeTier } from '@/lib/raffles/get-creator-fee-tier'
import { isAdmin } from '@/lib/db/admins'
import { listPartnerNestApplicationsByWallet } from '@/lib/db/partner-nest-applications'
import {
  creditPartnerRewardDeposit,
  getStakingPoolById,
  partnerRewardAvailableUi,
  type StakingPoolRow,
} from '@/lib/db/staking-pools'
import {
  getPartnerNestRewardDepositBySignature,
  insertPartnerNestRewardDeposit,
} from '@/lib/db/partner-nest-reward-deposits'
import {
  getPartnerNestRewardVaultWallet,
  isPartnerTokenRewardPool,
} from '@/lib/nesting/partner-reward-vault'
import { verifyPartnerNestRewardDepositTx } from '@/lib/nesting/verify-partner-nest-reward-deposit'
import { STAKING_UUID_RE } from '@/lib/nesting/validation'
import { isProbableSolanaPubkey } from '@/lib/nesting/admin-quick-pool'
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
 * GET /api/partners/nest-rewards/deposit?pool_id= — vault destination for building the deposit tx.
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
    if (!pool) return NextResponse.json({ error: 'Pool not found.' }, { status: 404 })

    const access = await assertPartnerOwnsPool(session.wallet, pool)
    if (access instanceof NextResponse) return access

    if (!isPartnerTokenRewardPool(pool) || !pool.reward_mint?.trim()) {
      return NextResponse.json(
        { error: 'Pool is not a partner-token reward perch.' },
        { status: 400 }
      )
    }

    const vaultWallet = getPartnerNestRewardVaultWallet()
    if (!vaultWallet) {
      return NextResponse.json(
        { error: 'Nesting reward vault is not configured on the server.' },
        { status: 503 }
      )
    }

    return NextResponse.json({
      vault_wallet: vaultWallet,
      reward_mint: pool.reward_mint,
      reward_token: pool.reward_token,
      reward_decimals: pool.reward_decimals ?? null,
      available: partnerRewardAvailableUi(pool),
    })
  } catch (e) {
    console.error('[partners/nest-rewards/deposit GET]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}

/**
 * POST /api/partners/nest-rewards/deposit
 * Body: { pool_id, amount, transaction_signature }
 */
export async function POST(request: NextRequest) {
  const session = await requireSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => ({}))
    const poolId = typeof body.pool_id === 'string' ? body.pool_id.trim() : ''
    const signature =
      typeof body.transaction_signature === 'string' ? body.transaction_signature.trim() : ''
    const amount = Number(body.amount)

    if (!poolId || !STAKING_UUID_RE.test(poolId)) {
      return NextResponse.json({ error: 'Valid pool_id is required.' }, { status: 400 })
    }
    if (!signature || signature.length < 64) {
      return NextResponse.json({ error: 'transaction_signature is required.' }, { status: 400 })
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be a positive number.' }, { status: 400 })
    }

    const pool = await getStakingPoolById(poolId)
    if (!pool) return NextResponse.json({ error: 'Pool not found.' }, { status: 404 })

    const access = await assertPartnerOwnsPool(session.wallet, pool)
    if (access instanceof NextResponse) return access

    if (!isPartnerTokenRewardPool(pool) || !pool.reward_mint?.trim()) {
      return NextResponse.json(
        { error: 'Pool is not a partner-token reward perch.' },
        { status: 400 }
      )
    }
    if (!isProbableSolanaPubkey(pool.reward_mint)) {
      return NextResponse.json({ error: 'Pool reward mint is invalid.' }, { status: 400 })
    }

    const vaultWallet = getPartnerNestRewardVaultWallet()
    if (!vaultWallet) {
      return NextResponse.json(
        { error: 'Nesting reward vault is not configured on the server.' },
        { status: 503 }
      )
    }

    const existing = await getPartnerNestRewardDepositBySignature(signature)
    if (existing) {
      return NextResponse.json({
        deposit: existing,
        already_recorded: true,
        available: partnerRewardAvailableUi((await getStakingPoolById(poolId)) ?? pool),
      })
    }

    const decimals =
      pool.reward_decimals != null && Number.isInteger(Number(pool.reward_decimals))
        ? Number(pool.reward_decimals)
        : 9

    const verified = await verifyPartnerNestRewardDepositTx({
      transactionSignature: signature,
      depositorWallet: session.wallet,
      vaultWallet,
      rewardMint: pool.reward_mint,
      expectedAmountUi: amount,
      decimals,
    })
    if (!verified.valid) {
      return NextResponse.json(
        { error: verified.error || 'Deposit verification failed.' },
        { status: 400 }
      )
    }

    const creditedAmount = verified.amountUi ?? amount
    const { deposit, created } = await insertPartnerNestRewardDeposit({
      pool_id: poolId,
      reward_mint: pool.reward_mint,
      amount: creditedAmount,
      transaction_signature: signature,
      depositor_wallet: session.wallet,
    })

    if (!created) {
      return NextResponse.json({
        deposit,
        already_recorded: true,
        available: partnerRewardAvailableUi((await getStakingPoolById(poolId)) ?? pool),
      })
    }

    const updatedPool = await creditPartnerRewardDeposit(poolId, creditedAmount)
    return NextResponse.json({
      deposit,
      already_recorded: false,
      available: partnerRewardAvailableUi(updatedPool),
      funded: Number(updatedPool.partner_reward_funded ?? 0),
      paid: Number(updatedPool.partner_reward_paid ?? 0),
    })
  } catch (e) {
    console.error('[partners/nest-rewards/deposit POST]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
