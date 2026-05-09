import { NextResponse } from 'next/server'

import { isAdmin } from '@/lib/db/admins'
import {
  normalizeSolanaWalletAddress,
  walletsEqualSolana,
} from '@/lib/solana/normalize-wallet'

/**
 * For routes where the wallet in the payload must belong to SIWS caller, unless caller is DB admin.
 * Returns NextResponse error or null when allowed.
 */
export async function forbidUnlessSelfOrAdmin(
  session: { wallet: string },
  claimWalletRaw: string
): Promise<NextResponse | null> {
  const target = normalizeSolanaWalletAddress(claimWalletRaw)
  if (!target) {
    return NextResponse.json({ error: 'Invalid wallet' }, { status: 400 })
  }

  const viewerCanonical = normalizeSolanaWalletAddress(session.wallet)
  if (!viewerCanonical) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  if (!walletsEqualSolana(session.wallet, target)) {
    const admin = await isAdmin(session.wallet)
    if (!admin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

  return null
}
