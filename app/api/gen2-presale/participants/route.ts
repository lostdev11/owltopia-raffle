import { NextRequest, NextResponse } from 'next/server'

import { getSessionFromRequest } from '@/lib/auth-server'
import { listGen2PresaleParticipants } from '@/lib/gen2-presale/db'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 150
const MAX_LIMIT = 500

export type Gen2PresaleParticipantMasked = {
  /** Truncated wallet for display only — full address is never exposed. */
  display: string
  purchased_spots: number
  /** Present when caller is signed in and this row is their wallet (server-side compare). */
  is_you: boolean
}

function maskWalletDisplay(w: string): string {
  const t = w.trim()
  if (t.length <= 12) return '…'
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-presale-participants:${ip}`, 60, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const session = getSessionFromRequest(request)
    const sessionNorm = session ? normalizeSolanaWalletAddress(session.wallet) : null

    const raw = request.nextUrl.searchParams.get('limit')
    const n = raw != null ? Math.floor(Number(raw)) : DEFAULT_LIMIT
    const limit = Number.isFinite(n) ? Math.min(MAX_LIMIT, Math.max(1, n)) : DEFAULT_LIMIT

    const rows = await listGen2PresaleParticipants(limit)

    const participants: Gen2PresaleParticipantMasked[] = rows.map((r) => {
      const rowNorm = normalizeSolanaWalletAddress(r.wallet)
      const is_you =
        sessionNorm !== null &&
        rowNorm !== null &&
        walletsEqualSolana(sessionNorm, rowNorm)

      return {
        display: maskWalletDisplay(r.wallet),
        purchased_spots: r.purchased_spots,
        is_you,
      }
    })

    return NextResponse.json({
      participants,
      count: participants.length,
    })
  } catch (error) {
    console.error('gen2-presale participants:', error)
    return NextResponse.json({ error: 'Failed to load participants' }, { status: 500 })
  }
}
