import { NextRequest, NextResponse } from 'next/server'
import { getSessionFromRequest } from '@/lib/auth-server'
import { getAdminRole } from '@/lib/db/admins'
import { getDiscordPartnerTenantIdForCreatorWallet } from '@/lib/db/partner-community-creators-admin'

export const dynamic = 'force-dynamic'

/**
 * Whether the connected session wallet may set list_on_platform=false (Discord / link only).
 */
export async function GET(request: NextRequest) {
  try {
    const session = getSessionFromRequest(request)
    const wallet = session?.wallet?.trim() ?? ''
    if (!wallet) {
      return NextResponse.json({ canSetLinkOnly: false })
    }
    if ((await getAdminRole(wallet)) !== null) {
      return NextResponse.json({ canSetLinkOnly: true })
    }
    const tenantId = await getDiscordPartnerTenantIdForCreatorWallet(wallet)
    const canSetLinkOnly = tenantId != null && String(tenantId).trim() !== ''
    return NextResponse.json({ canSetLinkOnly })
  } catch (e) {
    console.error('[GET /api/raffles/visibility-options]', e)
    return NextResponse.json({ canSetLinkOnly: false })
  }
}
