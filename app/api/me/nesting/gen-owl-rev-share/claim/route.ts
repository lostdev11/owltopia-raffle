import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { executeGenOwlRevShareClaim } from '@/lib/nesting/gen-owl-rev-share-claim-service'
import { StakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/me/nesting/gen-owl-rev-share/claim
 * Body: { period_month, position_id }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const period_month = typeof body.period_month === 'string' ? body.period_month.trim() : ''
    const position_id = typeof body.position_id === 'string' ? body.position_id.trim() : ''

    if (!period_month || !position_id) {
      return NextResponse.json({ error: 'period_month and position_id are required.' }, { status: 400 })
    }

    const result = await executeGenOwlRevShareClaim({
      wallet: session.wallet,
      period_month,
      position_id,
    })

    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof StakingUserError) {
      return NextResponse.json({ error: e.message, ...(e.extra ?? {}) }, { status: e.status })
    }
    console.error('[gen-owl-rev-share/claim]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
