import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { adminWalletRefundLookupQuery, parseOr400 } from '@/lib/validations'
import { getWalletRefundCandidates } from '@/lib/admin/wallet-refund-candidates'
import { rateLimit, getClientIp } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/wallet-refund-candidates?wallet=...
 * Full admin: list ticket + buyout refunds owed to a wallet (escrow vs legacy treasury).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`wallet-refund-lookup:${ip}:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'rate limited' }, { status: 429 })
    }

    const wallet = request.nextUrl.searchParams.get('wallet') ?? ''
    const parsed = parseOr400(adminWalletRefundLookupQuery, { wallet })
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const candidates = await getWalletRefundCandidates(parsed.data.wallet)
    const escrowCount = candidates.ticketEscrow.length + candidates.buyoutEscrow.length

    return NextResponse.json({
      ...candidates,
      summary: {
        escrowRefundableCount: escrowCount,
        treasuryBuyoutCount: candidates.buyoutTreasury.length,
        hasAnything:
          escrowCount > 0 || candidates.buyoutTreasury.length > 0,
      },
    })
  } catch (error) {
    console.error('[admin/wallet-refund-candidates]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
