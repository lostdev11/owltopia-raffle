import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { loadGenOwlRevShareLiabilityWithCoverage } from '@/lib/nesting/gen-owl-rev-share-liability-service'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/gen-owl-rev-share/liability
 * Claimed vs unclaimed nests/SOL across stacked open months + live pool coverage.
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const snapshot = await loadGenOwlRevShareLiabilityWithCoverage()
    return NextResponse.json({
      pool: snapshot.pool,
      coverage: snapshot.coverage,
      open: snapshot.liability.open,
      all: snapshot.liability.all,
      periods: snapshot.liability.periods.map((p) => ({
        period_month: p.period_month,
        claims_open: p.claims_open,
        finalized: p.finalized,
        deposited_sol: p.deposited_sol,
        deposited_usdc: p.deposited_usdc,
        paid_sol: p.paid_sol,
        paid_usdc: p.paid_usdc,
        unclaimed_sol: p.unclaimed_sol,
        unclaimed_usdc: p.unclaimed_usdc,
        eligible_nests: p.eligible_nests,
        claimed_nests: p.claimed_nests,
        unclaimed_nests: p.unclaimed_nests,
        claim_rate: p.claim_rate,
      })),
    })
  } catch (e) {
    console.error('[admin/gen-owl-rev-share/liability]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
