import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { executeUnstake } from '@/lib/nesting/service'
import { isStakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/me/staking/unstake
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
    const position_id = typeof body?.position_id === 'string' ? body.position_id.trim() : ''

    const result = await executeUnstake({
      wallet: session.wallet,
      position_id,
      platform_fee_signature: body?.platform_fee_signature,
    })
    const { position, nest_delegate_revoke, early_claim: earlyClaim } = result as typeof result & {
      early_claim?: { claimed?: number; claimed_rewards_total?: number } | null
    }

    return NextResponse.json({
      position,
      ...(earlyClaim
        ? {
            early_claim: {
              claimed: earlyClaim.claimed,
              claimed_rewards_total: earlyClaim.claimed_rewards_total,
            },
          }
        : {}),
      execution: {
        path: position.unstake_signature ? ('onchain_token_transfer' as const) : ('database_mock' as const),
        ...(nest_delegate_revoke?.mint
          ? { nest_delegate_revoke: { mint: nest_delegate_revoke.mint } }
          : {}),
      },
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    console.error('[me/staking/unstake]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
