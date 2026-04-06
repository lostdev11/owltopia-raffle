import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  createDiscordGiveawayPartner,
  listDiscordGiveawayPartners,
} from '@/lib/db/discord-giveaway-partners'
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import { safeErrorMessage } from '@/lib/safe-error'
import { getSiteBaseUrl } from '@/lib/site-config'
import type { DiscordGiveawayPartnerTenant } from '@/lib/types'

export const dynamic = 'force-dynamic'

function redactTenant(t: DiscordGiveawayPartnerTenant) {
  const { api_secret_hash: _h, ...rest } = t
  void _h
  return rest
}

/**
 * GET /api/admin/discord-giveaway-partners
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const list = await listDiscordGiveawayPartners()
    return NextResponse.json({ partners: list.map(redactTenant) })
  } catch (error) {
    console.error('[admin/discord-giveaway-partners GET]', error)
    const msg = safeErrorMessage(error)
    if (msg.toLowerCase().includes('discord_giveaway_partner') || msg.includes('does not exist')) {
      return NextResponse.json(
        { error: 'Partners table missing. Run migration 052_discord_giveaway_partner_tenants.sql.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/**
 * POST /api/admin/discord-giveaway-partners
 * Body: { name, webhook_url, discord_guild_id?, status?, active_until?, contact_note? }
 * Returns apiSecret once — store securely for the partner.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const webhook_url = typeof body.webhook_url === 'string' ? body.webhook_url.trim() : ''
    if (!name || !webhook_url) {
      return NextResponse.json({ error: 'name and webhook_url are required' }, { status: 400 })
    }
    if (!isAllowedDiscordIncomingWebhookUrl(webhook_url)) {
      return NextResponse.json(
        { error: 'webhook_url must be a Discord incoming webhook (https://discord.com/api/webhooks/…)' },
        { status: 400 }
      )
    }

    const status =
      body.status === 'active' || body.status === 'trial' || body.status === 'suspended'
        ? body.status
        : 'trial'

    const { tenant, apiSecret } = await createDiscordGiveawayPartner({
      name,
      webhook_url,
      discord_guild_id: typeof body.discord_guild_id === 'string' ? body.discord_guild_id.trim() : null,
      status,
      active_until: typeof body.active_until === 'string' ? body.active_until.trim() : null,
      contact_note: typeof body.contact_note === 'string' ? body.contact_note.trim() : null,
      created_by_wallet: session.wallet,
    })

    const base = getSiteBaseUrl()
    return NextResponse.json({
      partner: redactTenant(tenant),
      apiSecret,
      notifyUrl: `${base}/api/integrations/discord-giveaway/notify`,
      usage:
        'POST with header Authorization: Bearer <apiSecret> and JSON body { title, description?, url?, color?, content? }',
    })
  } catch (error) {
    console.error('[admin/discord-giveaway-partners POST]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
