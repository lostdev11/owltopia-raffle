import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth-server'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { listDiscordWlSubmissions, updateDiscordWlCampaign } from '@/lib/db/discord-wl-campaigns'
import { loadManagedDiscordWlCampaign, requirePartnerHubWallet } from '@/lib/discord-wl/partner-access'
import { bulkUpsertLaunchWlWallets } from '@/lib/db/owl-center-launch-wl-wallets'
import { getOwlCenterLaunchByIdAdmin, getOwlCenterLaunchBySlugAdmin } from '@/lib/db/owl-center-launch'
import { canEditLaunchMintDetails } from '@/lib/owl-center/creator-access'
import { launchHasWhitelistProgram } from '@/lib/owl-center/launch-wl-window'
import { resolvePartnerAllowlistPhases } from '@/lib/owl-center/partner-allowlist-phases'
import { mapPushWallets } from '@/lib/discord-wl/csv'
import { discordWlPhaseLabel } from '@/lib/discord-wl/campaign-rules'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * POST /api/partners/discord-wl-campaigns/[id]/push
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`partners-discord-wl-push:${ip}`, 10, 60_000).allowed) {
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
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'No wallets to push — open the spot and wait for submissions, or export is empty.' },
      { status: 400 }
    )
  }

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }
  const launchRaw = typeof body.launch === 'string' ? body.launch.trim() : ''
  let launchId = campaign.launch_id
  if (launchRaw) {
    const launch = UUID_RE.test(launchRaw)
      ? await getOwlCenterLaunchByIdAdmin(launchRaw)
      : await getOwlCenterLaunchBySlugAdmin(launchRaw)
    if (!launch) {
      return NextResponse.json(
        { error: 'Collection not found. Pick a launch from Owl Center or check the slug.' },
        { status: 404 }
      )
    }
    launchId = launch.id
  }
  if (!launchId) {
    return NextResponse.json(
      { error: 'Link a collection first. Set launch on the Discord spot or pass launch in this request.' },
      { status: 400 }
    )
  }

  const launch = await getOwlCenterLaunchByIdAdmin(launchId)
  if (!launch) {
    return NextResponse.json({ error: 'Collection not found.' }, { status: 404 })
  }
  const editor = await canEditLaunchMintDetails(session.wallet, launch)
  if (!editor.ok) {
    return NextResponse.json(
      { error: 'That collection belongs to a different wallet. Use a launch you created.' },
      { status: 403 }
    )
  }
  if (!launchHasWhitelistProgram(launch)) {
    return NextResponse.json(
      {
        error: `Your mint doesn’t have an **${discordWlPhaseLabel(campaign.phase_key)}** phase yet. Add it under Manage collection → Mint details, then push again.`,
      },
      { status: 400 }
    )
  }
  const phases = resolvePartnerAllowlistPhases(launch)
  if (phases.length > 0 && !phases.some((p) => p.key === campaign.phase_key)) {
    return NextResponse.json(
      {
        error: `Your mint doesn’t have an **${discordWlPhaseLabel(campaign.phase_key)}** phase yet. Add it under Manage collection → Mint details, then push again.`,
      },
      { status: 400 }
    )
  }

  const result = await bulkUpsertLaunchWlWallets({
    launchId: launch.id,
    phaseKey: campaign.phase_key,
    wallets: mapPushWallets({
      wallets: rows.map((r) => r.wallet),
      spotsPerWallet: campaign.spots_per_wallet,
      notePrefix: 'discord-wl',
    }),
    createdByWallet: session.wallet,
  })
  await updateDiscordWlCampaign(campaign.id, { last_pushed_at: new Date().toISOString(), launch_id: launch.id })

  return NextResponse.json({
    ok: true,
    upserted: result.upserted,
    failed: result.failed,
    launch_id: launch.id,
    launch_slug: launch.slug,
    phase_key: campaign.phase_key,
  })
}
