import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  getDiscordGiveawayPartnerById,
  updateDiscordGiveawayPartner,
} from '@/lib/db/discord-giveaway-partners'
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import { safeErrorMessage } from '@/lib/safe-error'
import type { DiscordGiveawayPartnerTenant } from '@/lib/types'

export const dynamic = 'force-dynamic'

function redactTenant(t: DiscordGiveawayPartnerTenant) {
  const { api_secret_hash: _h, ...rest } = t
  void _h
  return rest
}

/**
 * PATCH /api/admin/discord-giveaway-partners/[id]
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
    }

    const existing = await getDiscordGiveawayPartnerById(id)
    if (!existing) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => ({}))
    const patch: Parameters<typeof updateDiscordGiveawayPartner>[1] = {}

    if (typeof body.name === 'string') patch.name = body.name.trim()
    if (typeof body.webhook_url === 'string') {
      const w = body.webhook_url.trim()
      if (!isAllowedDiscordIncomingWebhookUrl(w)) {
        return NextResponse.json({ error: 'Invalid webhook_url' }, { status: 400 })
      }
      patch.webhook_url = w
    }
    if (body.raffle_webhook_url_created !== undefined) {
      if (body.raffle_webhook_url_created === null) {
        patch.raffle_webhook_url_created = null
      } else if (typeof body.raffle_webhook_url_created === 'string') {
        const w = body.raffle_webhook_url_created.trim()
        if (w && !isAllowedDiscordIncomingWebhookUrl(w)) {
          return NextResponse.json(
            { error: 'raffle_webhook_url_created must be a valid Discord incoming webhook' },
            { status: 400 }
          )
        }
        patch.raffle_webhook_url_created = w || null
      }
    }
    if (body.raffle_webhook_url_winner !== undefined) {
      if (body.raffle_webhook_url_winner === null) {
        patch.raffle_webhook_url_winner = null
      } else if (typeof body.raffle_webhook_url_winner === 'string') {
        const w = body.raffle_webhook_url_winner.trim()
        if (w && !isAllowedDiscordIncomingWebhookUrl(w)) {
          return NextResponse.json(
            { error: 'raffle_webhook_url_winner must be a valid Discord incoming webhook' },
            { status: 400 }
          )
        }
        patch.raffle_webhook_url_winner = w || null
      }
    }
    if (body.discord_guild_id !== undefined) {
      patch.discord_guild_id =
        typeof body.discord_guild_id === 'string' && body.discord_guild_id.trim()
          ? body.discord_guild_id.trim()
          : null
    }
    if (body.status === 'active' || body.status === 'trial' || body.status === 'suspended') {
      patch.status = body.status
    }
    if (body.active_until !== undefined) {
      patch.active_until =
        typeof body.active_until === 'string' && body.active_until.trim()
          ? body.active_until.trim()
          : null
    }
    if (typeof body.contact_note === 'string') patch.contact_note = body.contact_note.trim()

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
    }

    const updated = await updateDiscordGiveawayPartner(id, patch)
    if (!updated) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 })
    }
    return NextResponse.json({ partner: redactTenant(updated) })
  } catch (error) {
    console.error('[admin/discord-giveaway-partners PATCH]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
