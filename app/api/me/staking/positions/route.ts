import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { listStakingPositionsByWallet } from '@/lib/db/staking-positions'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/staking/positions
 * Signed-in wallet only; returns rows for session wallet (DB-backed).
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

    const positions = await listStakingPositionsByWallet(session.wallet)
    return NextResponse.json({ wallet: session.wallet, positions })
  } catch (e) {
    console.error('[me/staking/positions]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
