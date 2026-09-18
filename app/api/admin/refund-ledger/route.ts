import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { listTicketRefundLedgerAdmin } from '@/lib/db/ticket-refund-ledger'
import { safeErrorMessage } from '@/lib/safe-error'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/refund-ledger
 * Full admin: recent funds-escrow ticket refunds (optional wallet / raffle filter).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`admin-refund-ledger:${ip}:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const wallet = request.nextUrl.searchParams.get('wallet')?.trim() || undefined
    const raffleId = request.nextUrl.searchParams.get('raffleId')?.trim() || undefined
    const limitRaw = request.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : 50

    const refunds = await listTicketRefundLedgerAdmin({ wallet, raffleId, limit })
    return NextResponse.json({ refunds })
  } catch (e) {
    console.error('[admin/refund-ledger]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
