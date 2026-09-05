import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { listOwlSwapLedgerForWallet } from '@/lib/db/owl-swap'
import { isOwlSwapPublic } from '@/lib/owl-swap/access'
import { requireAdminSession } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

function requireConnectedMatchesSession(
  request: NextRequest,
  sessionWallet: string
): NextResponse | null {
  const connected = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
  if (!connected || connected !== sessionWallet) {
    return NextResponse.json(
      { error: 'Connected wallet does not match session. Sign in with this wallet.' },
      { status: 401 }
    )
  }
  return null
}

/** GET /api/owl-swap/ledger — session wallet swaps (private). */
export async function GET(request: NextRequest) {
  try {
    const session = isOwlSwapPublic()
      ? await requireSession(request)
      : await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const mismatch = requireConnectedMatchesSession(request, session.wallet)
    if (mismatch) return mismatch

    const ip = getClientIp(request)
    const rl = rateLimit(`owl-swap-ledger-get:${ip}:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const requested = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    if (requested && requested !== session.wallet) {
      return NextResponse.json(
        { error: 'You can only view your own OwlSwap ledger.' },
        { status: 403 }
      )
    }

    const limitRaw = Number(request.nextUrl.searchParams.get('limit') ?? '40')
    const rows = await listOwlSwapLedgerForWallet({
      wallet: session.wallet,
      limit: Number.isFinite(limitRaw) ? limitRaw : 40,
    })
    return NextResponse.json({ swaps: rows, wallet: session.wallet })
  } catch (e) {
    console.error('owl-swap ledger GET', e)
    return NextResponse.json({ error: 'Failed to load ledger' }, { status: 500 })
  }
}
