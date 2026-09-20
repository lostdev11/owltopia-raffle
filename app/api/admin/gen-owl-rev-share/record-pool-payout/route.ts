import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { recordGenOwlRevSharePoolPayoutFromChain } from '@/lib/nesting/gen-owl-rev-share-record-pool-payout'
import { loadGenOwlRevShareLiabilityWithCoverage } from '@/lib/nesting/gen-owl-rev-share-liability-service'
import { StakingUserError } from '@/lib/nesting/errors'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/gen-owl-rev-share/record-pool-payout
 * Body: { transaction_signature, expected_recipient? }
 * Backfill the payout ledger for an on-chain pool outflow that never got claim rows.
 */
export async function POST(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session
  try {
    const body = await request.json().catch(() => ({}))
    const recorded = await recordGenOwlRevSharePoolPayoutFromChain({
      transaction_signature:
        typeof body.transaction_signature === 'string' ? body.transaction_signature : '',
      expected_recipient:
        typeof body.expected_recipient === 'string' ? body.expected_recipient : null,
    })
    const snap = await loadGenOwlRevShareLiabilityWithCoverage()
    return NextResponse.json({
      ...recorded,
      orphan_payouts: snap.orphan_payouts,
      shortfall_sol: snap.coverage.shortfall_sol,
      pool_covered: snap.coverage.ok,
      hold_sol: snap.coverage.hold_sol,
      required_sol: snap.coverage.required_sol,
    })
  } catch (e) {
    if (e instanceof StakingUserError) {
      return NextResponse.json({ error: e.message }, { status: e.status })
    }
    console.error('[admin/gen-owl-rev-share/record-pool-payout]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
