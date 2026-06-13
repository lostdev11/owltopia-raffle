import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { getSessionFromRequest } from '@/lib/auth-server'
import { getOwlCenterAdminWallet } from '@/lib/owl-center/admin-access'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type GeneratorStageSession = {
  wallet: string
}

export async function requireGeneratorStageSession(
  request: NextRequest
): Promise<GeneratorStageSession | NextResponse> {
  const session = getSessionFromRequest(request)
  if (!session?.wallet) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 })
  }

  const adminWallet = await getOwlCenterAdminWallet(request)
  if (!adminWallet) {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) {
    return NextResponse.json({ error: 'Invalid session wallet' }, { status: 401 })
  }

  return { wallet }
}
