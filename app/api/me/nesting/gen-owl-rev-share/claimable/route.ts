import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { listGenOwlRevShareClaimableForWallet } from '@/lib/nesting/gen-owl-rev-share-claimable'
import { StakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/me/nesting/gen-owl-rev-share/claimable
 * SIWS session — nests eligible to claim monthly rev share.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const rows = await listGenOwlRevShareClaimableForWallet(session.wallet)
    const pending = rows.filter((r) => !r.already_claimed)
    return NextResponse.json({
      wallet: session.wallet,
      claimable: pending,
      history: rows.filter((r) => r.already_claimed),
    })
  } catch (e) {
    console.error('[gen-owl-rev-share/claimable]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
