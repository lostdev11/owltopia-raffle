import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { getPartnerRaffleVisibilityEntitlementForCreatorWallet } from '@/lib/db/partner-community-creators-admin'
import { getActivePartnerCommunityWalletSet } from '@/lib/raffles/partner-communities'
import { normalizeSolanaWalletAddress, walletsEqualSolana } from '@/lib/solana/normalize-wallet'

export const dynamic = 'force-dynamic'

/**
 * Whether the connected session wallet may set list_on_platform=false (partner raffle only).
 * Partner Pro+ gets the visibility control; `partnerDiscordLinked` tells the UI whether
 * create/winner webhooks can target that server's channels.
 * `isPartnerCommunityCreator` gates SPL partner-token prize creation (same allowlist as 2% fee tier).
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request)
    const wallet = session?.wallet?.trim() ?? ''
    if (!wallet) {
      return NextResponse.json({
        canSetLinkOnly: false,
        partnerDiscordLinked: false,
        isPartnerCommunityCreator: false,
      })
    }
    const [adminRole, entitlement, partnerWallets] = await Promise.all([
      getAdminRole(wallet),
      getPartnerRaffleVisibilityEntitlementForCreatorWallet(wallet),
      getActivePartnerCommunityWalletSet(),
    ])
    const partnerDiscordLinked =
      entitlement.discordPartnerTenantId != null && String(entitlement.discordPartnerTenantId).trim() !== ''
    const canSetLinkOnly = adminRole !== null || entitlement.canSetPartnerOnly
    const norm = normalizeSolanaWalletAddress(wallet)
    let isPartnerCommunityCreator = false
    if (norm) {
      for (const w of partnerWallets) {
        if (walletsEqualSolana(w, norm)) {
          isPartnerCommunityCreator = true
          break
        }
      }
    }
    return NextResponse.json({
      canSetLinkOnly,
      partnerDiscordLinked,
      partnerTier: entitlement.partnerTier,
      isPartnerCommunityCreator,
    })
  } catch (e) {
    console.error('[GET /api/raffles/visibility-options]', e)
    return NextResponse.json({
      canSetLinkOnly: false,
      partnerDiscordLinked: false,
      isPartnerCommunityCreator: false,
    })
  }
}
