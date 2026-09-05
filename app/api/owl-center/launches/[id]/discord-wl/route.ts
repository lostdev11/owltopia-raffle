import { NextRequest, NextResponse } from 'next/server'

import {
  countDiscordWlSubmissionsByCampaignIds,
  getDiscordWlCampaignById,
  listDiscordWlCampaignsByLaunchId,
  listDiscordWlSubmissions,
  updateDiscordWlCampaign,
} from '@/lib/db/discord-wl-campaigns'
import { bulkUpsertLaunchWlWallets } from '@/lib/db/owl-center-launch-wl-wallets'
import { getOwlCenterLaunchByIdAdmin } from '@/lib/db/owl-center-launch'
import { mapPushWallets } from '@/lib/discord-wl/csv'
import { discordWlPhaseLabel } from '@/lib/discord-wl/campaign-rules'
import { requireLaunchMintEditorSession } from '@/lib/owl-center/creator-access'
import { launchHasWhitelistProgram } from '@/lib/owl-center/launch-wl-window'
import { normalizePhaseKey, resolvePartnerAllowlistPhases } from '@/lib/owl-center/partner-allowlist-phases'
import { getClientIp, rateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

/**
 * GET /api/owl-center/launches/[id]/discord-wl
 * List Discord whitelist spots linked to this launch (creator import UI).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-discord-wl-get:${ip}`, 40, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  const campaigns = await listDiscordWlCampaignsByLaunchId(id)
  const counts = await countDiscordWlSubmissionsByCampaignIds(campaigns.map((c) => c.id))
  const phases = resolvePartnerAllowlistPhases(launch)

  return NextResponse.json({
    ok: true,
    launch_id: id,
    launch_phases: phases.map((p) => ({ key: p.key, label: p.label })),
    campaigns: campaigns.map((c) => ({
      id: c.id,
      name: c.name,
      phase_key: c.phase_key,
      phase_label: discordWlPhaseLabel(c.phase_key),
      status: c.status,
      wallet_count: counts[c.id] ?? 0,
      spots_per_wallet: c.spots_per_wallet,
      last_pushed_at: c.last_pushed_at,
      phase_on_launch: phases.length === 0 || phases.some((p) => p.key === c.phase_key),
    })),
  })
}

/**
 * POST /api/owl-center/launches/[id]/discord-wl
 * Body: { campaign_id: number, phase_key?: string }
 * Pull wallets from an Owltopia Discord whitelist spot into this launch allowlist phase.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const ip = getClientIp(request)
  if (!rateLimit(`owl-launch-discord-wl-import:${ip}`, 12, 60_000).allowed) {
    return jsonError('Too many requests', 429)
  }

  const { id } = await context.params
  if (!UUID_RE.test(id)) return jsonError('Invalid launch id', 400)

  const launch = await getOwlCenterLaunchByIdAdmin(id)
  if (!launch) return jsonError('Launch not found', 404)

  const editor = await requireLaunchMintEditorSession(request, launch)
  if (editor instanceof NextResponse) return editor

  let body: Record<string, unknown> = {}
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    body = {}
  }

  const campaignId = Math.floor(Number(body.campaign_id))
  if (!Number.isInteger(campaignId) || campaignId < 1) {
    return jsonError('campaign_id is required', 400)
  }

  const campaign = await getDiscordWlCampaignById(campaignId)
  if (!campaign) return jsonError('Discord whitelist spot not found', 404)
  if (campaign.launch_id && campaign.launch_id !== id) {
    return jsonError('That Discord spot is linked to a different collection', 403)
  }

  if (!launchHasWhitelistProgram(launch)) {
    return jsonError(
      `Add a ${discordWlPhaseLabel(campaign.phase_key)} (or WL) phase under Mint details before importing.`,
      400
    )
  }

  const phases = resolvePartnerAllowlistPhases(launch)
  const requestedPhase = typeof body.phase_key === 'string' ? normalizePhaseKey(body.phase_key) : ''
  const phaseKey = requestedPhase || campaign.phase_key
  if (phases.length > 0 && !phases.some((p) => p.key === phaseKey)) {
    return jsonError(
      `Your mint doesn’t have a “${discordWlPhaseLabel(phaseKey)}” phase. Add it in Mint details, or pass phase_key for an existing phase (e.g. wl).`,
      400
    )
  }

  const rows = await listDiscordWlSubmissions(campaign.id)
  if (rows.length === 0) {
    return jsonError(
      'No wallets on that Discord spot yet. Use /query mintlist in Discord to verify, or wait for submissions.',
      400
    )
  }

  const result = await bulkUpsertLaunchWlWallets({
    launchId: launch.id,
    phaseKey,
    wallets: mapPushWallets({
      wallets: rows.map((r) => r.wallet),
      spotsPerWallet: campaign.spots_per_wallet,
      notePrefix: 'discord-wl',
    }),
    createdByWallet: editor.wallet,
  })

  await updateDiscordWlCampaign(campaign.id, {
    last_pushed_at: new Date().toISOString(),
    launch_id: launch.id,
  })

  return NextResponse.json({
    ok: true,
    upserted: result.upserted,
    failed: result.failed,
    phase_key: phaseKey,
    phase_label: discordWlPhaseLabel(phaseKey),
    campaign_id: campaign.id,
    campaign_name: campaign.name,
    wallet_count: rows.length,
  })
}
