import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { createDiscordBroadcastTemplate } from '@/lib/db/discord-broadcast'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const messageBody = typeof body.body === 'string' ? body.body.trim() : ''

    if (!name) {
      return NextResponse.json({ error: 'Template name is required.' }, { status: 400 })
    }
    if (!messageBody) {
      return NextResponse.json({ error: 'Message body is required.' }, { status: 400 })
    }
    if (messageBody.length > 2000) {
      return NextResponse.json({ error: 'Message body must be 2000 characters or less.' }, { status: 400 })
    }

    const template = await createDiscordBroadcastTemplate({
      name,
      body: messageBody,
      created_by_wallet: session.wallet,
    })

    if (!template) {
      return NextResponse.json({ error: 'Failed to create template.' }, { status: 500 })
    }

    return NextResponse.json(template)
  } catch (error) {
    console.error('POST /api/admin/discord-broadcast/templates:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
