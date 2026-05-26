import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { auditNestingClaimLedger } from '@/lib/nesting/claim-ledger-audit'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/staking/claim-ledger-audit
 * Query: wallet (optional), flagged_only (default true), lookback_hours (default 168)
 */
export async function GET(request: NextRequest) {
  const session = await requireFullAdminSession(request)
  if (session instanceof NextResponse) return session

  try {
    const { searchParams } = new URL(request.url)
    const wallet = searchParams.get('wallet')?.trim() || undefined
    const flaggedOnly = searchParams.get('flagged_only') !== 'false'
    const lookbackRaw = searchParams.get('lookback_hours')
    const lookbackHours =
      lookbackRaw != null && Number.isFinite(Number(lookbackRaw)) ? Number(lookbackRaw) : undefined

    const report = await auditNestingClaimLedger({
      wallet,
      flaggedOnly: wallet ? false : flaggedOnly,
      lookbackHours,
    })

    return NextResponse.json(report)
  } catch (e) {
    console.error('[admin/staking/claim-ledger-audit]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
