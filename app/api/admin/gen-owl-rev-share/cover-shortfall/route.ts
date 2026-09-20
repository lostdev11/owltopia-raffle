import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { loadGenOwlRevShareLiabilityWithCoverage } from '@/lib/nesting/gen-owl-rev-share-liability-service'
import {
  confirmGenOwlRevShareCoverageTopUp,
  suggestedGenOwlRevShareCoverShortfallSol,
} from '@/lib/nesting/gen-owl-rev-share-cover-shortfall'
import { getGenOwlRevSharePoolPublicKey } from '@/lib/nesting/gen-owl-rev-share-pool'
import { StakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/gen-owl-rev-share/cover-shortfall
 * Suggested SOL amount to close the live coverage hole (does not credit period books).
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  const address = getGenOwlRevSharePoolPublicKey()
  if (!address) {
    return NextResponse.json(
      {
        error:
          'Rev share pool is not configured. Set GEN_OWL_REV_SHARE_POOL_SECRET_KEY on the server.',
      },
      { status: 503 }
    )
  }

  const snap = await loadGenOwlRevShareLiabilityWithCoverage()
  const shortfall = snap.coverage.shortfall_sol
  return NextResponse.json({
    address,
    pool_covered: snap.coverage.ok,
    shortfall_sol: shortfall,
    suggested_sol: suggestedGenOwlRevShareCoverShortfallSol(shortfall),
    hold_sol: snap.coverage.hold_sol,
    required_sol: snap.coverage.required_sol,
    message: snap.coverage.error,
  })
}

/**
 * POST /api/admin/gen-owl-rev-share/cover-shortfall
 * Verify a SOL transfer into the pool without crediting claimable period totals.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const result = await confirmGenOwlRevShareCoverageTopUp({
      depositorWallet: session.wallet,
      amount_sol: body.amount_sol != null ? Number(body.amount_sol) : 0,
      sol_signature: typeof body.sol_signature === 'string' ? body.sol_signature : '',
      allow_older_tx: body.allow_older_tx === true,
    })
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof StakingUserError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('[admin/gen-owl-rev-share/cover-shortfall]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
