import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { councilEscrowDepositConfirmBody, parseOr400 } from '@/lib/validations'
import { isCouncilOwlEscrowVotingEnabled } from '@/lib/council/council-owl-escrow-keypair'
import { getCouncilEscrowMinDepositRaw } from '@/lib/council/council-owl-escrow-config'
import { rpcCreditCouncilEscrowDeposit } from '@/lib/db/owl-council-escrow'
import { verifyCouncilOwlEscrowDeposit } from '@/lib/solana/verify-council-owl-escrow-deposit'
import { isOwlEnabled } from '@/lib/tokens'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const HEADER = 'x-connected-wallet'

/**
 * POST /api/council/escrow/confirm-deposit
 * Body: { signature } — SPL transfer of OWL to council escrow (amount ≥ min deposit).
 */
export async function POST(request: NextRequest) {
  try {
    if (!isOwlEnabled() || !isCouncilOwlEscrowVotingEnabled()) {
      return NextResponse.json({ error: 'Council OWL escrow is not enabled.' }, { status: 503 })
    }

    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connected = request.headers.get(HEADER)?.trim()
    if (!connected || connected !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session.' },
        { status: 401 }
      )
    }

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip')?.trim() ||
      'unknown'
    const wallet = session.wallet.trim()
    const ipRl = rateLimit(`council-escrow-dep:ip:${ip}`, 40, 60_000)
    if (!ipRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const wRl = rateLimit(`council-escrow-dep:wallet:${wallet}`, 20, 60_000)
    if (!wRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(councilEscrowDepositConfirmBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }

    const minRaw = getCouncilEscrowMinDepositRaw()
    const verified = await verifyCouncilOwlEscrowDeposit({
      signature: parsed.data.signature,
      payerWallet: wallet,
      minRaw,
    })
    if (!verified.ok) {
      return NextResponse.json({ error: verified.error }, { status: 400 })
    }

    const credited = await rpcCreditCouncilEscrowDeposit(wallet, verified.amountRaw, parsed.data.signature.trim())
    if (!credited.ok) {
      const status = credited.code === 'duplicate_tx' ? 400 : 500
      return NextResponse.json({ error: credited.message }, { status })
    }

    return NextResponse.json({ ok: true, creditedRaw: verified.amountRaw.toString() })
  } catch (error) {
    console.error('[api/council/escrow/confirm-deposit] POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
