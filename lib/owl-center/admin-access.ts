import type { NextRequest } from 'next/server'

import { isOwlVisionAdmin } from '@/lib/admin/access'
import { getSessionFromRequest } from '@/lib/auth-server'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

/** Wallet from SIWS session when it belongs to an Owl Vision admin (DB or ADMIN_WALLETS). */
export async function getOwlCenterAdminWallet(request: NextRequest): Promise<string | null> {
  const session = getSessionFromRequest(request)
  if (!session?.wallet) return null
  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) return null
  if (!(await isOwlVisionAdmin(wallet))) return null
  return wallet
}
