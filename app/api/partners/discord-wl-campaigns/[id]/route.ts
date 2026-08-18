import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { listDiscordWlSubmissions } from '@/lib/db/discord-wl-campaigns'
import { loadManagedDiscordWlCampaign, requirePartnerHubWallet } from '@/lib/discord-wl/partner-access'
import { discordWlPhaseLabel } from '@/lib/discord-wl/campaign-rules'

export const dynamic = 'force-dynamic'

/**
 * GET /api/partners/discord-wl-campaigns/[id] — wallets for copy
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`partners-discord-wl-get:${ip}`, 40, 60_000).allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const session = await requireSession(request)
  if (session instanceof NextResponse) return session
  const access = await requirePartnerHubWallet(session.wallet)
  if (access instanceof NextResponse) return access

  const { id } = await context.params
  const campaign = await loadManagedDiscordWlCampaign(session.wallet, id)
  if (campaign instanceof NextResponse) return campaign

  const rows = await listDiscordWlSubmissions(campaign.id)
  return NextResponse.json({
    ok: true,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      phase_key: campaign.phase_key,
      phase_label: discordWlPhaseLabel(campaign.phase_key),
      status: campaign.status,
      spots_per_wallet: campaign.spots_per_wallet,
      launch_id: campaign.launch_id,
    },
    wallets: rows.map((r) => r.wallet),
    wallet_count: rows.length,
  })
}
