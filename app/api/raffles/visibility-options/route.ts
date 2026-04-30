import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { getDiscordPartnerTenantIdForCreatorWallet } from '@/lib/db/partner-community-creators-admin'

export const dynamic = 'force-dynamic'

/**
 * Whether the connected session wallet may set list_on_platform=false (Discord / link only).
 * `partnerDiscordLinked` is true when this wallet is on the partner program list with a Discord tenant
 * (raffle create/winner webhooks can target that server’s channels only — see /owltopia-partner slash commands).
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request)
    const wallet = session?.wallet?.trim() ?? ''
    if (!wallet) {
      return NextResponse.json({ canSetLinkOnly: false, partnerDiscordLinked: false })
    }
    const [adminRole, tenantId] = await Promise.all([
      getAdminRole(wallet),
      getDiscordPartnerTenantIdForCreatorWallet(wallet),
    ])
    const partnerDiscordLinked = tenantId != null && String(tenantId).trim() !== ''
    const canSetLinkOnly = adminRole !== null || partnerDiscordLinked
    return NextResponse.json({ canSetLinkOnly, partnerDiscordLinked })
  } catch (e) {
    console.error('[GET /api/raffles/visibility-options]', e)
    return NextResponse.json({ canSetLinkOnly: false, partnerDiscordLinked: false })
  }
}
