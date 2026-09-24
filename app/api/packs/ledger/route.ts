import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import {
  countCompletedPackOpensForWallet,
  listCompletedPackOpensForWallet,
} from '@/lib/packs/db'

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

/** GET /api/packs/ledger — completed opens for the signed-in wallet only. */
export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const mismatch = requireConnectedMatchesSession(request, session.wallet)
    if (mismatch) return mismatch

    const ip = getClientIp(request)
    const rl = rateLimit(`packs-ledger-get:${ip}:${session.wallet}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const requested = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    if (requested && requested !== session.wallet) {
      return NextResponse.json(
        { error: 'You can only view your own pack history.' },
        { status: 403 }
      )
    }

    const limitRaw = Number(request.nextUrl.searchParams.get('limit') ?? '20')
    const offsetRaw = Number(request.nextUrl.searchParams.get('offset') ?? '0')
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20
    const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0

    const [total, opens] = await Promise.all([
      countCompletedPackOpensForWallet(session.wallet),
      listCompletedPackOpensForWallet({
        wallet: session.wallet,
        limit,
        offset,
      }),
    ])

    return NextResponse.json({
      wallet: session.wallet,
      total,
      limit: Math.min(Math.max(limit, 1), 50),
      offset: Math.max(offset, 0),
      opens,
    })
  } catch (e) {
    console.error('[packs] ledger GET', e)
    return NextResponse.json({ error: 'Failed to load pack ledger' }, { status: 500 })
  }
}
