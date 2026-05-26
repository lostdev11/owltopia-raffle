import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { clearOrphanedActiveNftNestsForWallet } from '@/lib/nesting/clear-orphaned-active-nests'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/staking/clear-orphaned-active
 * Body: { wallet: string } — closes active NFT nests with no on-chain lock (stuck “already nested” / cannot claim).
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const body = await request.json().catch(() => null)
    const wallet = typeof body?.wallet === 'string' ? body.wallet.trim() : ''
    if (!wallet) {
      return NextResponse.json({ error: 'wallet is required' }, { status: 400 })
    }

    const result = await clearOrphanedActiveNftNestsForWallet(wallet)

    console.warn('[admin/staking/clear-orphaned-active]', {
      admin_wallet: session.wallet,
      holder_wallet: wallet,
      cleared_count: result.cleared_count,
    })

    return NextResponse.json(result)
  } catch (e) {
    console.error('[admin/staking/clear-orphaned-active]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
