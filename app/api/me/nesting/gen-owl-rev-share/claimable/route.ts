import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { areGenOwlRevShareClaimsEnabled } from '@/lib/db/rev-share-schedule'
import { listGenOwlRevShareClaimableForWallet } from '@/lib/nesting/gen-owl-rev-share-claimable'
import { assessGenOwlRevSharePoolAffordability } from '@/lib/nesting/gen-owl-rev-share-pool'
import { loadGenOwlRevShareLiabilityWithCoverage } from '@/lib/nesting/gen-owl-rev-share-liability-service'
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

    const claimsEnabled = await areGenOwlRevShareClaimsEnabled()
    const rows = claimsEnabled ? await listGenOwlRevShareClaimableForWallet(session.wallet) : []
    const pending = rows.filter((r) => !r.already_claimed)

    let pendingSol = 0
    let pendingUsdc = 0
    for (const row of pending) {
      pendingSol += row.amount_sol
      pendingUsdc += row.amount_usdc
    }

    const [pool, liabilitySnap] = await Promise.all([
      claimsEnabled && pending.length > 0
        ? assessGenOwlRevSharePoolAffordability({
            amount_sol: pendingSol,
            amount_usdc: pendingUsdc,
          })
        : Promise.resolve(null),
      claimsEnabled ? loadGenOwlRevShareLiabilityWithCoverage() : Promise.resolve(null),
    ])

    const coverageOk = liabilitySnap?.coverage.ok !== false
    const canPayThisWallet = pool ? pool.ok && coverageOk : coverageOk

    return NextResponse.json({
      wallet: session.wallet,
      claims_enabled: claimsEnabled,
      claimable: pending,
      history: claimsEnabled ? rows.filter((r) => r.already_claimed) : [],
      pool: pool
        ? {
            can_pay: canPayThisWallet,
            need_sol: pool.need_sol,
            hold_sol: pool.hold_sol,
            need_usdc: pool.need_usdc,
            hold_usdc: pool.hold_usdc,
            shortfall_sol: pool.shortfall_sol,
            shortfall_usdc: pool.shortfall_usdc,
            message: !coverageOk ? liabilitySnap?.coverage.error : pool.error,
          }
        : liabilitySnap && !liabilitySnap.coverage.ok
          ? {
              can_pay: false,
              need_sol: liabilitySnap.coverage.required_sol,
              hold_sol: liabilitySnap.coverage.hold_sol,
              need_usdc: liabilitySnap.coverage.required_usdc,
              hold_usdc: liabilitySnap.coverage.hold_usdc,
              shortfall_sol: liabilitySnap.coverage.shortfall_sol,
              shortfall_usdc: liabilitySnap.coverage.shortfall_usdc,
              message: liabilitySnap.coverage.error,
            }
          : null,
      liability: liabilitySnap
        ? {
            open_period_count: liabilitySnap.liability.open.open_period_count,
            claimed_nests: liabilitySnap.liability.open.claimed_nests,
            unclaimed_nests: liabilitySnap.liability.open.unclaimed_nests,
            paid_sol: liabilitySnap.liability.open.paid_sol,
            unclaimed_sol: liabilitySnap.liability.open.unclaimed_sol,
            paid_usdc: liabilitySnap.liability.open.paid_usdc,
            unclaimed_usdc: liabilitySnap.liability.open.unclaimed_usdc,
            required_sol: liabilitySnap.liability.open.required_sol,
            pool_sol: liabilitySnap.pool.sol,
            pool_covered: liabilitySnap.coverage.ok,
          }
        : null,
    })
  } catch (e) {
    console.error('[gen-owl-rev-share/claimable]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
