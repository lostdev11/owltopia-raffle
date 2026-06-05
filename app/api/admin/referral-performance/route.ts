import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getAdminReferralPerformance,
  type AdminReferralPerformancePayload,
} from '@/lib/db/admin-referral-performance'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

function toCsv(payload: AdminReferralPerformancePayload): string {
  const lines = [
    'metric,value',
    `referral_visits,${payload.summary.referralVisits}`,
    `referral_ticket_purchases,${payload.summary.referralTicketPurchases}`,
    `free_entries_issued,${payload.summary.freeEntriesIssued}`,
    `free_entries_confirmed,${payload.summary.freeEntriesConfirmed}`,
    `referred_revenue,${payload.summary.referredRevenue}`,
    '',
    'top_code,tickets,revenue',
    ...payload.topCodes.map((r) => `${r.code},${r.tickets},${r.revenue}`),
  ]
  return lines.join('\n')
}

/**
 * GET /api/admin/referral-performance
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const sp = request.nextUrl.searchParams
    const filters = {
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
      raffleId: sp.get('raffleId') ?? undefined,
      creatorWallet: sp.get('creatorWallet') ?? undefined,
      referralCode: sp.get('referralCode') ?? undefined,
      rewardMode: sp.get('rewardMode') ?? undefined,
    }

    const payload = await getAdminReferralPerformance(filters)

    if (sp.get('format') === 'csv') {
      return new NextResponse(toCsv(payload), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="referral-performance.csv"',
        },
      })
    }

    return NextResponse.json(payload)
  } catch (error) {
    console.error('[admin/referral-performance]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
