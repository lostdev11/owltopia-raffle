import { NextRequest, NextResponse } from 'next/server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { requireOwlSwapAccess } from '@/lib/owl-swap/require-owl-swap-access'
import { listOwlSwapOffersForMaker } from '@/lib/db/owl-swap'

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

/** GET /api/owl-swap/offers/mine — maker's offers. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireOwlSwapAccess(request)
    if (session instanceof NextResponse) return session

    const mismatch = requireConnectedMatchesSession(request, session.wallet)
    if (mismatch) return mismatch

    const ip = getClientIp(request)
    const rl = rateLimit(`owl-swap-mine:${ip}:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const limitRaw = Number(request.nextUrl.searchParams.get('limit') ?? '40')
    const offers = await listOwlSwapOffersForMaker({
      makerWallet: session.wallet,
      limit: Number.isFinite(limitRaw) ? limitRaw : 40,
    })
    return NextResponse.json({ offers, wallet: session.wallet })
  } catch (e) {
    console.error('owl-swap offers/mine GET', e)
    return NextResponse.json({ error: 'Failed to load offers' }, { status: 500 })
  }
}
