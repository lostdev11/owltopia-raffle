import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { councilEscrowWithdrawBody, parseOr400 } from '@/lib/validations'
import { isCouncilOwlEscrowVotingEnabled } from '@/lib/council/council-owl-escrow-keypair'
import { getOwlCouncilEscrowBalanceRaw, rpcFinalizeCouncilEscrowWithdrawal } from '@/lib/db/owl-council-escrow'
import { transferCouncilOwlFromEscrowToWallet } from '@/lib/council/council-owl-escrow-withdraw'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import { owlUiToRawBigint } from '@/lib/council/owl-amount-format'
import { rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const HEADER = 'x-connected-wallet'

/**
 * POST /api/council/escrow/withdraw
 * Body: { withdrawAll?: true } | { amountUi: number } — SPL transfer from council escrow → wallet, then ledger debit.
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
    const ipRl = rateLimit(`council-escrow-wd:ip:${ip}`, 30, 60_000)
    if (!ipRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const wRl = rateLimit(`council-escrow-wd:wallet:${wallet}`, 10, 60_000)
    if (!wRl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(councilEscrowWithdrawBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }

    const owl = getTokenInfo('OWL')
    if (!owl.mintAddress) {
      return NextResponse.json({ error: 'OWL not configured' }, { status: 503 })
    }

    const bal = await getOwlCouncilEscrowBalanceRaw(wallet)
    let amountRaw = 0n
    if (parsed.data.withdrawAll) {
      amountRaw = bal
    } else if (parsed.data.amountUi !== undefined) {
      amountRaw = owlUiToRawBigint(parsed.data.amountUi, owl.decimals)
    }

    if (amountRaw <= 0n) {
      return NextResponse.json({ error: 'Withdraw amount must be positive.' }, { status: 400 })
    }
    if (amountRaw > bal) {
      return NextResponse.json({ error: 'Amount exceeds your credited council escrow balance.' }, { status: 400 })
    }

    const out = await transferCouncilOwlFromEscrowToWallet({
      recipientWallet: wallet,
      amountRaw,
    })
    if (!out.ok) {
      return NextResponse.json({ error: out.error }, { status: 502 })
    }

    const fin = await rpcFinalizeCouncilEscrowWithdrawal(wallet, amountRaw, out.signature)
    if (!fin.ok) {
      console.error(
        '[api/council/escrow/withdraw] CRITICAL: on-chain withdraw succeeded but ledger finalize failed',
        { wallet, amountRaw: amountRaw.toString(), signature: out.signature, error: fin.message }
      )
      return NextResponse.json(
        {
          error:
            'Transfer was sent on-chain but the balance update failed. Save this signature and contact support: ' +
            out.signature,
          signature: out.signature,
        },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true, signature: out.signature, withdrawnRaw: amountRaw.toString() })
  } catch (error) {
    console.error('[api/council/escrow/withdraw] POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
