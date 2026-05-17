import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { clearOrphanedPendingNftNestsForWallet } from '@/lib/nesting/clear-orphaned-pending-nests'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/staking/clear-orphaned-pending
 * Body: { wallet: string } — clears pending `awaiting_nft_freeze` rows when the NFT was never frozen on-chain.
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

    const result = await clearOrphanedPendingNftNestsForWallet(wallet)

    console.warn('[admin/staking/clear-orphaned-pending]', {
      admin_wallet: session.wallet,
      holder_wallet: wallet,
      cleared_count: result.cleared_count,
    })

    return NextResponse.json(result)
  } catch (e) {
    console.error('[admin/staking/clear-orphaned-pending]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
