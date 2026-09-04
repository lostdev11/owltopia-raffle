import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { getPartnerRaffleVisibilityEntitlementForCreatorWallet } from '@/lib/db/partner-community-creators-admin'
import {
  countDiscordWlSubmissionsByCampaignIds,
  listDiscordWlCampaignsForPartner,
} from '@/lib/db/discord-wl-campaigns'
import { requirePartnerHubWallet } from '@/lib/discord-wl/partner-access'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { discordWlPhaseLabel } from '@/lib/discord-wl/campaign-rules'

export const dynamic = 'force-dynamic'

/**
 * GET /api/partners/discord-wl-campaigns
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  if (!rateLimit(`partners-discord-wl-list:${ip}`, 40, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  const access = await requirePartnerHubWallet(session.wallet)
  if (access instanceof NextResponse) return access

  const entitlement = await getPartnerRaffleVisibilityEntitlementForCreatorWallet(session.wallet)
  const campaigns = await listDiscordWlCampaignsForPartner({
    wallet: session.wallet,
    tenantId: entitlement.discordPartnerTenantId,
  })
  const counts = await countDiscordWlSubmissionsByCampaignIds(campaigns.map((c) => c.id))

  const launches = await Promise.all(
    campaigns.map(async (c) => (c.launch_id ? getOwlCenterLaunchByIdAdmin(c.launch_id) : null))
  )

  return NextResponse.json({
    ok: true,
    campaigns: campaigns.map((c, i) => ({
      id: c.id,
      name: c.name,
      phase_key: c.phase_key,
      phase_label: discordWlPhaseLabel(c.phase_key),
      status: c.status,
      channel_id: c.channel_id,
      max_entries: c.max_entries,
      spots_per_wallet: c.spots_per_wallet,
      wallet_count: counts[c.id] ?? 0,
      launch_id: c.launch_id,
      launch_name: launches[i]?.name ?? null,
      launch_slug: launches[i]?.slug ?? null,
      last_pushed_at: c.last_pushed_at,
      created_at: c.created_at,
    })),
  })
}
