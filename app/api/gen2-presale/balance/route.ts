import { NextRequest, NextResponse } from 'next/server'

import { requireSession } from '@/lib/auth-server'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-balance:${ip}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const walletRaw = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    const walletParam = normalizeSolanaWalletAddress(walletRaw)
    const sessionWallet = normalizeSolanaWalletAddress(session.wallet)
    if (!sessionWallet) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
    }
    if (!walletParam || !walletsEqualSolana(walletParam, sessionWallet)) {
      return NextResponse.json(
        { error: 'wallet must match your signed-in session' },
        { status: 403 }
      )
    }

    const row = await getBalanceByWallet(walletParam)
    if (!row) {
      return NextResponse.json({
        wallet: walletParam,
        purchased_mints: 0,
        gifted_mints: 0,
        used_mints: 0,
        available_mints: 0,
      })
    }

    return NextResponse.json(row)
  } catch (error) {
    console.error('gen2-presale balance:', error)
    return NextResponse.json({ error: 'Failed to load balance' }, { status: 500 })
  }
}
