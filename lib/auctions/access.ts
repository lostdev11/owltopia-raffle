import { isAdmin } from '@/lib/db/admins'
import { getActivePartnerCommunityWalletSet } from '@/lib/raffles/partner-communities'
import {
  normalizeSolanaWalletAddress,
  walletsEqualSolana,
} from '@/lib/solana/normalize-wallet'

/**
 * Auctions v1: browse + create are partner or site-admin only.
 * Keeps quality high (Sifu: avoid flood of dead listings).
 */
export async function canAccessPartnerAuctions(wallet: string): Promise<boolean> {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized) return false
  if (await isAdmin(normalized)) return true
  const partners = await getActivePartnerCommunityWalletSet()
  for (const partner of partners) {
    if (walletsEqualSolana(partner, normalized)) return true
  }
  return false
}

export async function canCreatePartnerAuction(wallet: string): Promise<boolean> {
  return canAccessPartnerAuctions(wallet)
}
