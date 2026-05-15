import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { listStakingRewardEventsByWallet } from '@/lib/db/staking-reward-events'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/staking/reward-events
 * Claim ledger for the signed-in wallet (staking_reward_events, claim rows only).
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

    const limitRaw = request.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : 40

    const events = await listStakingRewardEventsByWallet(session.wallet, limit)
    return NextResponse.json({ wallet: session.wallet, events })
  } catch (e) {
    console.error('[me/staking/reward-events]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
