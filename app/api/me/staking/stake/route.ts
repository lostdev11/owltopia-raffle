import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { executeStake } from '@/lib/nesting/service'
import { isStakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/me/staking/stake
 * Delegates to nesting service + staking adapter (mock until on-chain ships).
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

    const { position } = await executeStake({
      wallet: session.wallet,
      pool_id: typeof body?.pool_id === 'string' ? body.pool_id.trim() : '',
      rawAmount: body?.amount,
      rawAssetIdentifier: body?.asset_identifier,
    })

    return NextResponse.json({
      position,
      execution: { path: 'database_mock' as const },
    })
  } catch (e) {
    if (isStakingUserError(e)) {
      return NextResponse.json({ error: e.message, ...e.extra }, { status: e.status })
    }
    console.error('[me/staking/stake]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
