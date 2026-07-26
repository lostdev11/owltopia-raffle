import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getGenOwlRevShareEstimateForWallet } from '@/lib/nesting/gen-owl-rev-share-estimate'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/me/nesting/gen-owl-rev-share/estimate
 * SIWS session — projected current-month rev share for active Gen 1 / Gen 2 nests.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const estimate = await getGenOwlRevShareEstimateForWallet(session.wallet)
    return NextResponse.json({
      wallet: session.wallet,
      estimate,
    })
  } catch (e) {
    console.error('[gen-owl-rev-share/estimate]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
