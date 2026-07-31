import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { executeGenOwlRevShareClaimAll } from '@/lib/nesting/gen-owl-rev-share-claim-service'
import { StakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * POST /api/me/nesting/gen-owl-rev-share/claim-all
 * Body: { platform_fee_signature }
 * Claims every pending Gen nest rev-share row for the session wallet in one pooled payout.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))

    const result = await executeGenOwlRevShareClaimAll({
      wallet: session.wallet,
      platform_fee_signature: body?.platform_fee_signature,
    })

    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof StakingUserError) {
      return NextResponse.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status })
    }
    console.error('[gen-owl-rev-share/claim-all]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
