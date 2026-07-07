import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { executeStake } from '@/lib/nesting/service'
import { isStakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'
import {
  nestExecutionForPool,
  resolveEffectiveNftLockStandard,
} from '@/lib/nesting/nft-lock-service'
import { getNestingNftFreezeDelegateAddress } from '@/lib/nesting/nft-freeze'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/me/staking/stake
 * Delegates to nesting service + staking adapter (DB, token vault, or NFT freeze lock).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => null)

    const bypassSelloutGate = body?.bypass_nesting_sellout_gate === true

    const { position, pool } = await executeStake({
      wallet: session.wallet,
      pool_id: typeof body?.pool_id === 'string' ? body.pool_id.trim() : '',
      rawAmount: body?.amount,
      rawAssetIdentifier: body?.asset_identifier,
      bypassSelloutGate,
      platform_fee_signature: body?.platform_fee_signature,
    })

    const resolvedStandard =
      position.sync_status === 'pending' && pool.asset_type === 'nft'
        ? await resolveEffectiveNftLockStandard(pool, position.asset_identifier)
        : null
    const execution = nestExecutionForPool(pool, resolvedStandard ?? undefined)

    return NextResponse.json({
      position,
      execution: {
        path:
          position.sync_status === 'pending' && pool.asset_type === 'nft'
            ? execution.path
            : position.sync_status === 'pending'
              ? ('onchain_token_transfer_required' as const)
              : ('database_mock' as const),
        freeze_delegate:
          position.sync_status === 'pending' &&
          pool.asset_type === 'nft' &&
          execution.requires_wallet_signature
            ? getNestingNftFreezeDelegateAddress()
            : null,
        nft_lock_standard: resolvedStandard,
        requires_wallet_signature: execution.requires_wallet_signature,
      },
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    console.error('[me/staking/stake]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
