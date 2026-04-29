import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { claimOfferRefund } from '@/lib/db/raffle-offers'

export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const offerId = params.id
    if (typeof offerId !== 'string') {
      return NextResponse.json({ error: 'Invalid offer id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const rawTx = typeof (body as { refundTxSignature?: unknown }).refundTxSignature === 'string'
      ? (body as { refundTxSignature: string }).refundTxSignature.trim()
      : ''
    const refundTxSignature = rawTx.length > 0 ? rawTx : null
    if (refundTxSignature && refundTxSignature.length > 128) {
      return NextResponse.json(
        { error: 'refundTxSignature must be at most 128 characters' },
        { status: 400 }
      )
    }

    await claimOfferRefund({
      offerId,
      walletAddress: session.wallet,
      refundTxSignature,
    })
    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to claim offer refund'
    const status =
      message.includes('not found')
        ? 404
        : message.includes('Only the offer buyer') || message.includes('eligible')
          ? 403
          : message.includes('already refunded')
            ? 409
            : 500
    if (status === 500) {
      console.error('[POST /api/me/raffle-offers/[id]/claim-refund]', error)
    }
    return NextResponse.json({ error: message }, { status })
  }
}
