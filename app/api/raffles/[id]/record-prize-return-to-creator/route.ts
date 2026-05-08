import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  PRIZE_RETURN_REASONS,
  recordManualPrizeReturnToCreator,
  type PrizeReturnReason,
} from '@/lib/raffles/prize-escrow'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  transactionSignature: z.string().trim().min(80).max(120),
  reason: z
    .string()
    .trim()
    .refine((s): s is PrizeReturnReason =>
      (PRIZE_RETURN_REASONS as readonly string[]).includes(s)
    ),
})

/**
 * POST /api/raffles/[id]/record-prize-return-to-creator
 * Full admin: after manually sending the escrow prize back to the creator (any wallet), persist the
 * Solana transaction signature so dashboards and create-raffle NFT loading stay consistent.
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

    let json: unknown
    try {
      json = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'Request body must be JSON with transactionSignature and reason' },
        { status: 400 }
      )
    }

    const parsed = bodySchema.safeParse(json)
    if (!parsed.success) {
      return NextResponse.json(
        {
          error:
            parsed.error.flatten().fieldErrors.transactionSignature?.[0] ??
            parsed.error.flatten().fieldErrors.reason?.[0] ??
            'Invalid body: transactionSignature and reason required',
        },
        { status: 400 }
      )
    }

    const { transactionSignature, reason } = parsed.data
    const result = await recordManualPrizeReturnToCreator(raffleId, reason, transactionSignature)

    if (!result.ok) {
      const status = result.error?.includes('not found') ? 404 : 400
      return NextResponse.json({ error: result.error ?? 'Failed to record prize return' }, { status })
    }

    return NextResponse.json({
      success: true,
      transactionSignature: result.signature,
      message: 'Manual prize return recorded successfully',
    })
  } catch (error) {
    console.error('[POST /api/raffles/[id]/record-prize-return-to-creator]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
