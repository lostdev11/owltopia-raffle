import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  transferNftPrizeToCreator,
  transferPartnerSplPrizeToCreator,
  PRIZE_RETURN_REASONS,
  type PrizeReturnReason,
} from '@/lib/raffles/prize-escrow'
import { getRaffleById } from '@/lib/db/raffles'
import { isPartnerSplPrizeRaffle } from '@/lib/partner-prize-tokens'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/return-prize-to-creator
 * Sends the NFT prize from escrow back to the raffle creator. Admin only.
 * Use for defined cases only: raffle cancelled, wrong NFT, dispute resolution, or platform error.
 * Body: { "reason": "cancelled" | "wrong_nft" | "dispute" | "platform_error" }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    let body: { reason?: unknown }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Request body must be JSON with a reason' },
        { status: 400 }
      )
    }
    if (body == null || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be a JSON object with a reason' },
        { status: 400 }
      )
    }

    const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
    if (!reason) {
      return NextResponse.json(
        { error: 'reason is required. Allowed: cancelled, wrong_nft, dispute, platform_error, testing' },
        { status: 400 }
      )
    }
    if (!PRIZE_RETURN_REASONS.includes(reason as PrizeReturnReason)) {
      return NextResponse.json(
        { error: `Invalid reason "${reason}". Allowed: ${PRIZE_RETURN_REASONS.join(', ')}` },
        { status: 400 }
      )
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }
    const result = isPartnerSplPrizeRaffle(raffle)
      ? await transferPartnerSplPrizeToCreator(raffleId, reason as PrizeReturnReason)
      : await transferNftPrizeToCreator(raffleId, reason as PrizeReturnReason)

    if (!result.ok) {
      const status = result.error?.includes('not found') ? 404 : 400
      return NextResponse.json(
        { error: result.error ?? 'Failed to return prize to creator' },
        { status }
      )
    }

    return NextResponse.json({
      success: true,
      raffleId,
      reason,
      transactionSignature: result.signature,
      message: 'Prize returned to creator successfully',
    })
  } catch (error) {
    console.error('Return prize to creator error:', error)
    return NextResponse.json(
      { error: safeErrorMessage(error) },
      { status: 500 }
    )
  }
}
