import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { markEntriesRefundedManual } from '@/lib/db/entries'
import { requireFullAdminSession } from '@/lib/auth-server'
import { safeErrorMessage } from '@/lib/safe-error'
import { parseOr400, recordManualRefundsBody } from '@/lib/validations'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/record-refunds
 * Full admin: paste payout tx signature after sending refunds manually; sets refunded_at on selected entries.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const raffleId = typeof params.id === 'string' ? params.id.trim() : ''
    if (!raffleId) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(recordManualRefundsBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const { entryIds, transactionSignature } = parsed.data
    const { updatedIds } = await markEntriesRefundedManual(raffleId, entryIds, transactionSignature)

    if (updatedIds.length === 0) {
      return NextResponse.json(
        {
          error:
            'No entries were updated. They may already be refunded, not confirmed, or not belong to this raffle.',
        },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      updatedCount: updatedIds.length,
      requestedCount: entryIds.length,
      updatedIds,
    })
  } catch (error) {
    console.error('[record-refunds]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
