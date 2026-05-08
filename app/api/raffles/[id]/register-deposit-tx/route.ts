import { NextRequest, NextResponse } from 'next/server'
import { getRaffleById, updateRaffle } from '@/lib/db/raffles'
import { normalizeDepositTxSignatureInput } from '@/lib/raffles/verify-prize-deposit-client'
import { verifyPrizeDepositInternal } from '@/lib/raffles/verify-prize-deposit-internal'
import { requireSession } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'

export const dynamic = 'force-dynamic'

/**
 * POST /api/raffles/[id]/register-deposit-tx
 * Saves the on-chain escrow deposit signature then attempts verification immediately.
 * Cron retries verify for rows that remain pending so creators do not need to tap Verify manually.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const raw =
      typeof body.deposit_tx === 'string' ? normalizeDepositTxSignatureInput(body.deposit_tx) : ''
    if (!raw) {
      return NextResponse.json({ error: 'deposit_tx is required' }, { status: 400 })
    }

    const raffle = await getRaffleById(id)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const creatorWallet = (raffle.creator_wallet || raffle.created_by || '').trim()
    const isCreator = creatorWallet && session.wallet === creatorWallet
    const isAdmin = (await getAdminRole(session.wallet)) !== null
    if (!isCreator && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (raffle.prize_deposited_at) {
      return NextResponse.json({
        ok: true,
        registered: false,
        verified: true,
        alreadyLive: true,
        prizeDepositedAt: raffle.prize_deposited_at,
      })
    }

    await updateRaffle(id, { prize_deposit_tx: raw })

    const result = await verifyPrizeDepositInternal(id, raw)
    if (!result.ok) {
      return NextResponse.json({
        ok: true,
        registered: true,
        verified: false,
        pendingReason: result.error,
        ...(result.frozenEscrowDiagnostics
          ? { frozenEscrowDiagnostics: result.frozenEscrowDiagnostics }
          : {}),
      })
    }

    return NextResponse.json({
      ok: true,
      registered: true,
      verified: true,
      prizeDepositedAt: result.prizeDepositedAt,
    })
  } catch (error) {
    console.error('register-deposit-tx error:', error)
    return NextResponse.json({ error: 'Failed to register deposit' }, { status: 500 })
  }
}
