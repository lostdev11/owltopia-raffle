import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { getPartnerRaffleVisibilityEntitlementForCreatorWallet } from '@/lib/db/partner-community-creators-admin'

export const dynamic = 'force-dynamic'

/**
 * Whether the connected session wallet may set list_on_platform=false (partner raffle only).
 * Partner Pro+ gets the visibility control; `partnerDiscordLinked` tells the UI whether
 * create/winner webhooks can target that server's channels.
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request)
    const wallet = session?.wallet?.trim() ?? ''
    if (!wallet) {
      return NextResponse.json({ canSetLinkOnly: false, partnerDiscordLinked: false })
    }
    const [adminRole, entitlement] = await Promise.all([
      getAdminRole(wallet),
      getPartnerRaffleVisibilityEntitlementForCreatorWallet(wallet),
    ])
    const partnerDiscordLinked =
      entitlement.discordPartnerTenantId != null && String(entitlement.discordPartnerTenantId).trim() !== ''
    const canSetLinkOnly = adminRole !== null || entitlement.canSetPartnerOnly
    return NextResponse.json({
      canSetLinkOnly,
      partnerDiscordLinked,
      partnerTier: entitlement.partnerTier,
    })
  } catch (e) {
    console.error('[GET /api/raffles/visibility-options]', e)
    return NextResponse.json({ canSetLinkOnly: false, partnerDiscordLinked: false })
  }
}
