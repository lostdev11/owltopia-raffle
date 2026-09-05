import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { areGenOwlRevShareClaimsEnabled } from '@/lib/db/rev-share-schedule'
import { listGenOwlRevShareClaimableForWallet } from '@/lib/nesting/gen-owl-rev-share-claimable'
import { assessGenOwlRevSharePoolAffordability } from '@/lib/nesting/gen-owl-rev-share-pool'
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

    const pool =
      claimsEnabled && pending.length > 0
        ? await assessGenOwlRevSharePoolAffordability({
            amount_sol: pendingSol,
            amount_usdc: pendingUsdc,
          })
        : null

    return NextResponse.json({
      wallet: session.wallet,
      claims_enabled: claimsEnabled,
      claimable: pending,
      history: claimsEnabled ? rows.filter((r) => r.already_claimed) : [],
      pool: pool
        ? {
            can_pay: pool.ok,
            need_sol: pool.need_sol,
            hold_sol: pool.hold_sol,
            need_usdc: pool.need_usdc,
            hold_usdc: pool.hold_usdc,
            shortfall_sol: pool.shortfall_sol,
            shortfall_usdc: pool.shortfall_usdc,
            message: pool.error,
          }
        : null,
    })
  } catch (e) {
    console.error('[gen-owl-rev-share/claimable]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
