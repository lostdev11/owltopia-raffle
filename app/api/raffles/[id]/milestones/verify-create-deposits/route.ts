import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { verifyCreateMilestoneDepositsInternal } from '@/lib/raffles/milestones/verify-create-deposits'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { normalizeDepositTxSignatureInput } from '@/lib/raffles/verify-prize-deposit-client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/milestones/verify-create-deposits
 * Body: { deposit_tx, currency: 'SOL' | 'USDC' }
 * Verifies a combined funds-escrow deposit for all pending milestones of that currency.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const raffleId = params.id
    if (typeof raffleId !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const depositTx =
      typeof body.deposit_tx === 'string' ? normalizeDepositTxSignatureInput(body.deposit_tx) : ''
    const currencyRaw = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : ''
    if (!depositTx) {
      return NextResponse.json({ error: 'deposit_tx is required' }, { status: 400 })
    }
    if (currencyRaw !== 'SOL' && currencyRaw !== 'USDC') {
      return NextResponse.json({ error: 'currency must be SOL or USDC' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator = creatorWallet && session.wallet === creatorWallet
    const isAdmin = (await getAdminRole(session.wallet)) !== null
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await verifyCreateMilestoneDepositsInternal({
      raffleId,
      depositTx,
      creatorWallet: session.wallet,
      currency: currencyRaw,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus ?? 400 })
    }

    return NextResponse.json({
      ok: true,
      depositVerifiedAt: result.depositVerifiedAt,
      published: result.published,
      milestoneIds: result.milestoneIds,
    })
  } catch (error) {
    console.error('[milestones/verify-create-deposits]', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
