import type { NextRequest } from 'next/server'

import { isOwlVisionAdmin } from '@/lib/admin/access'
import { getSessionFromRequest } from '@/lib/auth-server'
import { isApprovedOwlCenterPartner } from '@/lib/db/owl-center-partners'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

export type OwlCenterLaunchAccess = {
  wallet: string
  isAdmin: boolean
  isPartner: boolean
}

/**
 * SIWS session wallet when it may use launchpad tools (submit wizard + Owl Generator):
 * Owl Vision admins or approved launchpad partners (`owl_center_partners`).
 */
export async function getOwlCenterLaunchAccess(
  request: NextRequest
): Promise<OwlCenterLaunchAccess | null> {
  const session = getSessionFromRequest(request)
  if (!session?.wallet) return null
  const wallet = normalizeSolanaWalletAddress(session.wallet)
  if (!wallet) return null

  if (await isOwlVisionAdmin(wallet)) {
    return { wallet, isAdmin: true, isPartner: false }
  }
  if (await isApprovedOwlCenterPartner(wallet)) {
    return { wallet, isAdmin: false, isPartner: true }
  }
  return null
}
