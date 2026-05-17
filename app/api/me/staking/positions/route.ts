import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { healPendingNftNestsForWallet } from '@/lib/nesting/heal-pending-nft-freeze'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/staking/positions
 * SIWS session required — returns staking rows for the session wallet (DB-backed).
 */
export async function GET(request: NextRequest) {
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

    const healDisabled = request.nextUrl.searchParams.get('heal') === '0'
    if (healDisabled) {
      const positions = await listStakingPositionsByWallet(session.wallet)
      return NextResponse.json({ wallet: session.wallet, positions })
    }

    const { positions, results: heal_results } = await healPendingNftNestsForWallet(session.wallet)
    const healed_count = heal_results.filter((r) => r.healed).length
    return NextResponse.json({
      wallet: session.wallet,
      positions,
      ...(healed_count > 0 ? { healed_count, heal_results } : {}),
    })
  } catch (e) {
    console.error('[me/staking/positions]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
