import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById } from '@/lib/db/raffles'
import { getMilestoneById } from '@/lib/db/raffle-milestones'
import { verifyMilestoneDepositInternal } from '@/lib/raffles/milestones/verify-deposit'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { normalizeDepositTxSignatureInput } from '@/lib/raffles/verify-prize-deposit-client'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/milestones/verify-deposit
 * Body: { milestone_id, deposit_tx }
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
    const milestoneId = typeof body.milestone_id === 'string' ? body.milestone_id.trim() : ''
    const depositTx =
      typeof body.deposit_tx === 'string' ? normalizeDepositTxSignatureInput(body.deposit_tx) : ''
    if (!milestoneId || !depositTx) {
      return NextResponse.json({ error: 'milestone_id and deposit_tx are required' }, { status: 400 })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const milestone = await getMilestoneById(milestoneId)
    if (!milestone || milestone.raffle_id !== raffleId) {
      return NextResponse.json({ error: 'Milestone not found' }, { status: 404 })
    }

    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator = creatorWallet && session.wallet === creatorWallet
    const isAdmin = (await getAdminRole(session.wallet)) !== null
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const result = await verifyMilestoneDepositInternal({
      milestoneId,
      depositTx,
      creatorWallet: session.wallet,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error },
        { status: result.httpStatus ?? 400 }
      )
    }

    return NextResponse.json({
      ok: true,
      depositVerifiedAt: result.depositVerifiedAt,
      published: result.published,
    })
  } catch (error) {
    console.error('[milestones/verify-deposit]', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
