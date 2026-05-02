import { NextRequest, NextResponse } from 'next/server'

import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    const rl = rateLimit(`gen2-balance:${ip}`, 120, 60_000)
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const walletRaw = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    const wallet = normalizeSolanaWalletAddress(walletRaw)
    if (!wallet) {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const row = await getBalanceByWallet(wallet)
    if (!row) {
      return NextResponse.json({
        wallet,
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
