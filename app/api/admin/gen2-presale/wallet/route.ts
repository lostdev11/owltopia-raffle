import { NextRequest, NextResponse } from 'next/server'

import { requireGen2PresaleAdminSession } from '@/lib/gen2-presale/admin-auth'
import { getBalanceByWallet } from '@/lib/gen2-presale/db'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireGen2PresaleAdminSession(request)
    if (session instanceof NextResponse) return session

    const walletRaw = request.nextUrl.searchParams.get('wallet')?.trim() ?? ''
    const wallet = normalizeSolanaWalletAddress(walletRaw)
    if (!wallet) {
      return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
    }

    const balance = await getBalanceByWallet(wallet)
    return NextResponse.json({
      balance: balance ?? {
        wallet,
        purchased_mints: 0,
        gifted_mints: 0,
        used_mints: 0,
        available_mints: 0,
      },
    })
  } catch (error) {
    console.error('admin gen2-presale wallet:', error)
    return NextResponse.json({ error: 'Failed to load wallet' }, { status: 500 })
  }
}
