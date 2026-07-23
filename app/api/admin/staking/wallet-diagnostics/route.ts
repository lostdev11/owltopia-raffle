import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import { diagnoseNestingWallet } from '@/lib/nesting/admin-wallet-diagnostics'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET /api/admin/staking/wallet-diagnostics?wallet=<address>
 * Support audit: ledger vs on-chain vs cross-wallet blockers for Owltopia coins, Gen 1, and Gen 2 nests.
 */
export async function GET(request: NextRequest) {
  const session = await requireAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    if (!wallet) {
      return NextResponse.json({ error: 'wallet query param is required' }, { status: 400 })
    }

    const report = await diagnoseNestingWallet(wallet)
    const fixable_high = report.issues.filter((i) => i.severity === 'high').length

    return NextResponse.json({
      ...report,
      summary: {
        issue_count: report.issues.length,
        high_severity_count: fixable_high,
        has_cross_wallet_blockers: report.cross_wallet_rows.length > 0,
        recommended_heal: {
          clear_pending: report.issues.some((i) => i.kind === 'orphaned_pending'),
          clear_active: report.issues.some((i) => i.kind === 'orphaned_active'),
          clear_cross_wallet: report.cross_wallet_rows.length > 0,
        },
        ghost_active_count: report.positions_under_wallet.ghost_active,
      },
    })
  } catch (e) {
    console.error('[admin/staking/wallet-diagnostics]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
