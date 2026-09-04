import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { listDiscordWlSubmissions } from '@/lib/db/discord-wl-campaigns'
import { loadManagedDiscordWlCampaign, requirePartnerHubWallet } from '@/lib/discord-wl/partner-access'
import { buildDiscordWlExportCsv } from '@/lib/discord-wl/csv'
import { sanitizeExportFilenameSegment } from '@/lib/raffles/entrant-export'

export const dynamic = 'force-dynamic'

/**
 * GET /api/partners/discord-wl-campaigns/[id]/export
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`partners-discord-wl-export:${ip}`, 20, 60_000).allowed) {
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
  const csv = buildDiscordWlExportCsv(
    rows.map((r) => ({
      wallet: r.wallet,
      phase_key: campaign.phase_key,
      discord_user_id: r.discord_user_id,
      discord_username: r.discord_username,
      submitted_at: r.created_at,
      spots: campaign.spots_per_wallet,
    }))
  )
  const namePart = sanitizeExportFilenameSegment(campaign.name || 'whitelist')
  const datePart = new Date().toISOString().slice(0, 10)
  const filename = `wl-${namePart}-${campaign.phase_key}-${datePart}.csv`

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
