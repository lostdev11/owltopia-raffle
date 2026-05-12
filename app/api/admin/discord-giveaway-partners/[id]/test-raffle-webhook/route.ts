import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { getDiscordGiveawayPartnerById } from '@/lib/db/discord-giveaway-partners'
import { isAllowedDiscordIncomingWebhookUrl } from '@/lib/discord-webhook-url'
import { safeErrorMessage } from '@/lib/safe-error'
import { getSiteBaseUrl, PLATFORM_NAME } from '@/lib/site-config'

export const dynamic = 'force-dynamic'

const WEBHOOK_TIMEOUT_MS = 8_000

function shortWallet(wallet: string): string {
  const w = wallet.trim()
  if (w.length <= 12) return w
  return `${w.slice(0, 4)}...${w.slice(-4)}`
}

async function postTestWebhook(webhookUrl: string, payload: Record<string, unknown>): Promise<void> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`Discord returned ${res.status}: ${text.slice(0, 200)}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<Record<string, string | string[] | undefined>> }
) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const params = await context.params
    const id = params.id
    if (typeof id !== 'string') {
      return NextResponse.json({ error: 'Invalid partner id' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const target = body?.target === 'winner' ? 'winner' : 'created'
    const partner = await getDiscordGiveawayPartnerById(id)
    if (!partner) {
      return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
    }

    const webhookUrl =
      target === 'winner'
        ? partner.raffle_webhook_url_winner?.trim()
        : partner.raffle_webhook_url_created?.trim()
    if (!webhookUrl) {
      return NextResponse.json(
        { error: `No ${target === 'winner' ? 'winner' : 'created'} raffle webhook URL is saved for this partner.` },
        { status: 400 }
      )
    }
    if (!isAllowedDiscordIncomingWebhookUrl(webhookUrl)) {
      return NextResponse.json({ error: 'Saved webhook URL is not a valid Discord incoming webhook.' }, { status: 400 })
    }

    const base = getSiteBaseUrl()
    const targetLabel = target === 'winner' ? 'winner webhook' : 'created webhook'
    await postTestWebhook(webhookUrl, {
      username: PLATFORM_NAME,
      content: `Test ${targetLabel} from ${PLATFORM_NAME}.`,
      allowed_mentions: { parse: [] },
      embeds: [
        {
          title: `Test ${targetLabel}`,
          description:
            target === 'winner'
              ? 'If you can see this, partner raffle winner posts are connected.'
              : 'If you can see this, partner raffle created posts are connected.',
          url: `${base}/raffles`,
          color: target === 'winner' ? 0xfee75c : 0x57f287,
          fields: [
            { name: 'Partner', value: partner.name, inline: true },
            { name: 'Requested by', value: `\`${shortWallet(session.wallet)}\``, inline: true },
            { name: 'Tenant id', value: `\`${partner.id}\``, inline: false },
          ],
          timestamp: new Date().toISOString(),
        },
      ],
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[admin/discord-giveaway-partners test-raffle-webhook]', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
