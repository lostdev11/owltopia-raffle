import { NextRequest, NextResponse } from 'next/server'
import {
  findPartnerTenantByApiSecret,
  isPartnerTenantEntitled,
} from '@/lib/db/discord-giveaway-partners'
import {
  postDiscordIncomingWebhookContentAndEmbed,
  postDiscordIncomingWebhookEmbed,
} from '@/lib/discord-incoming-webhook'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/integrations/discord-giveaway/notify
 * Paid/trial partners: Authorization Bearer <api_secret> (shown once when admin creates the tenant).
 * Body: { title: string, description?: string, url?: string, color?: number, content?: string }
 * Delivers to the partner's Discord **incoming webhook** (they create it in their server).
 *
 * This is not a hosted Discord bot process; communities can pair this with their own bot/cron calling our API,
 * or rely on automatic posts when an NFT giveaway is linked to their tenant and verified/claimed.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = request.headers.get('authorization')?.trim() ?? ''
    const secret = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
    if (!secret) {
      return NextResponse.json({ error: 'Missing Authorization: Bearer <api_secret>' }, { status: 401 })
    }

    const ip = getClientIp(request)
    const rl = rateLimit(`discord-giveaway-partner-notify:${ip}`, 45, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Try again shortly.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    let tenant
    try {
      tenant = await findPartnerTenantByApiSecret(secret)
    } catch (e) {
      console.error('partner notify lookup:', e)
      return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
    }

    if (!tenant || !isPartnerTenantEntitled(tenant)) {
      return NextResponse.json({ error: 'Invalid or inactive partner key' }, { status: 403 })
    }
    if (!tenant.webhook_url?.trim()) {
      return NextResponse.json(
        {
          error:
            'Webhook not configured. In Discord run /owltopia-partner webhook url:<your incoming webhook URL>.',
        },
        { status: 400 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 256) : ''
    if (!title) {
      return NextResponse.json({ error: 'title is required (max 256 chars)' }, { status: 400 })
    }
    const description =
      typeof body.description === 'string' ? body.description.trim().slice(0, 3800) : undefined
    const url =
      typeof body.url === 'string' && /^https?:\/\//i.test(body.url)
        ? body.url.trim().slice(0, 2000)
        : undefined
    const content = typeof body.content === 'string' ? body.content.trim().slice(0, 1900) : undefined
    const colorRaw = body.color
    const color =
      typeof colorRaw === 'number' &&
      Number.isFinite(colorRaw) &&
      colorRaw >= 0 &&
      colorRaw <= 0xffffff
        ? Math.floor(colorRaw)
        : 0x5865f2

    const embed = {
      title,
      description,
      url,
      color,
      timestamp: new Date().toISOString(),
    }

    const ok = content
      ? await postDiscordIncomingWebhookContentAndEmbed(tenant.webhook_url, content, embed)
      : await postDiscordIncomingWebhookEmbed(tenant.webhook_url, embed)

    if (!ok) {
      return NextResponse.json({ error: 'Discord webhook delivery failed' }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[integrations/discord-giveaway/notify]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
