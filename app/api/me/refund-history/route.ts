import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { listTicketRefundLedgerByWallet } from '@/lib/db/ticket-refund-ledger'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/refund-history
 * Ticket refund ledger for the signed-in wallet (amount, when sent, Solscan tx).
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connectedWallet = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (connectedWallet && connectedWallet !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Please sign in again.' },
        { status: 401 }
      )
    }

    const limitRaw = request.nextUrl.searchParams.get('limit')
    const limit = limitRaw ? Number(limitRaw) : 40
    const refunds = await listTicketRefundLedgerByWallet(session.wallet, limit)
    return NextResponse.json({ wallet: session.wallet, refunds })
  } catch (e) {
    console.error('[me/refund-history]', e)
    return NextResponse.json({ error: safeErrorMessage(e) }, { status: 500 })
  }
}
