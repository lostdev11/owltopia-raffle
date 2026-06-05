import type { NextRequest } from 'next/server'

import { getSessionFromRequest } from '@/lib/auth-server'
import { isAdmin } from '@/lib/db/admins'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

/** Wallet from SIWS session when it belongs to an Owl Vision admin. */
export async function getOwlCenterAdminWallet(request: NextRequest): Promise<string | null> {
  const session = getSessionFromRequest(request)
  if (!session?.wallet) return null
  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) return null
  if (!(await isAdmin(wallet))) return null
  return wallet
}
