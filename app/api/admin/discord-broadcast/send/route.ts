import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { sendDiscordBroadcastBody } from '@/lib/discord-broadcast/run-schedules'
import { getDiscordBroadcastTemplate } from '@/lib/db/discord-broadcast'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * POST /api/admin/discord-broadcast/send
 * Manual post with preview confirmation (body from template or override).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const ip = getClientIp(request)
    const rl = rateLimit(`discord-broadcast-send:${ip}:${session.wallet}`, 20, 60_000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many sends. Try again in a minute.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }

    const body = await request.json().catch(() => ({}))
    const templateId = typeof body.template_id === 'string' ? body.template_id.trim() : ''
    const postToPublic = body.post_to_public !== false
    const postToHolder = body.post_to_holder === true

    if (!postToPublic && !postToHolder) {
      return NextResponse.json({ error: 'Select at least one channel.' }, { status: 400 })
    }

    let messageBody = typeof body.body === 'string' ? body.body.trim() : ''
    if (!messageBody && templateId) {
      const template = await getDiscordBroadcastTemplate(templateId)
      if (!template) {
        return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
      }
      messageBody = template.body.trim()
    }

    if (!messageBody) {
      return NextResponse.json({ error: 'Message body is required.' }, { status: 400 })
    }
    if (messageBody.length > 2000) {
      return NextResponse.json({ error: 'Message body must be 2000 characters or less.' }, { status: 400 })
    }

    const result = await sendDiscordBroadcastBody({
      body: messageBody,
      postToPublic,
      postToHolder,
      templateId: templateId || null,
      triggeredBy: 'manual',
      createdByWallet: session.wallet,
    })

    if (result.status === 'failed') {
      return NextResponse.json(
        { error: result.error ?? 'Discord post failed.', status: result.status },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      status: result.status,
      sentTo: result.sentTo,
      failedTo: result.failedTo,
      warning: result.error,
    })
  } catch (error) {
    console.error('POST /api/admin/discord-broadcast/send:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
