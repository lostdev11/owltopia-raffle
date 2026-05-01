import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getRaffleById, getEntriesByRaffleId } from '@/lib/db/raffles'
import {
  aggregateConfirmedEntrantsForExport,
  buildEntrantExportCsv,
  sanitizeExportFilenameSegment,
  canExportRaffleEntrantCsv,
} from '@/lib/raffles/entrant-export'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * GET /api/me/raffles/[raffleId]/entrants/export
 *
 * CSV of confirmed, non-refunded entrants (aggregated per wallet).
 * Allowed: site admins (any raffle), or active partner-program wallets (own raffles only).
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
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

    const params = await context.params
    const raffleIdRaw = params.raffleId
    const raffleId = typeof raffleIdRaw === 'string' ? raffleIdRaw.trim() : ''
    if (!raffleId) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const allowed = await canExportRaffleEntrantCsv(session.wallet, raffle)
    if (!allowed) {
      return NextResponse.json(
        {
          error:
            'You cannot export this raffle. Partner creators may export their own raffles; site admins may export any raffle.',
        },
        { status: 403 }
      )
    }

    const entries = await getEntriesByRaffleId(raffle.id)
    const rows = aggregateConfirmedEntrantsForExport(entries)
    const csv = buildEntrantExportCsv(rows)
    const slugPart = sanitizeExportFilenameSegment(raffle.slug || 'raffle')
    const datePart = new Date().toISOString().slice(0, 10)
    const filename = `entrants-${slugPart}-${datePart}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    console.error('[api/me/raffles/entrants/export]', e)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
