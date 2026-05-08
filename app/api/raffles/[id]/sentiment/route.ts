import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { parseOr400, raffleSentimentBody } from '@/lib/validations'
import { getRaffleById } from '@/lib/db/raffles'
import {
  getRaffleSentimentTotals,
  upsertRaffleSentiment,
} from '@/lib/db/raffle-sentiment'

export const dynamic = 'force-dynamic'

const CONNECTED_WALLET_HEADER = 'x-connected-wallet'

/**
 * POST /api/raffles/[id]/sentiment
 * SIWS session + X-Connected-Wallet must match. One reaction per wallet per raffle (upsert to change).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const params = await context.params
    const id = params.id
    if (typeof id !== 'string' || !id.trim()) {
      return NextResponse.json({ error: 'Invalid raffle id' }, { status: 400 })
    }
    const raffleId = id.trim()

    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const connected = request.headers.get(CONNECTED_WALLET_HEADER)?.trim()
    if (!connected || connected !== session.wallet) {
      return NextResponse.json(
        { error: 'Connected wallet does not match session. Sign in with the connected wallet.' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const parsed = parseOr400(raffleSentimentBody, body)
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status })
    }

    const raffle = await getRaffleById(raffleId)
    if (!raffle) {
      return NextResponse.json({ error: 'Raffle not found' }, { status: 404 })
    }

    const write = await upsertRaffleSentiment({
      raffleId,
      wallet: session.wallet,
      sentiment: parsed.data.sentiment,
    })
    if (!write.ok) {
      return NextResponse.json({ error: write.message }, { status: 500 })
    }

    const totals = await getRaffleSentimentTotals(raffleId)
    return NextResponse.json({ ok: true, totals, sentiment: parsed.data.sentiment })
  } catch (error) {
    console.error('[api/raffles/sentiment] POST:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
