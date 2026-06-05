import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  deleteDiscordBroadcastTemplate,
  updateDiscordBroadcastTemplate,
} from '@/lib/db/discord-broadcast'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: 'Template id required.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const attrs: { name?: string; body?: string } = {}

    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) {
        return NextResponse.json({ error: 'Template name cannot be empty.' }, { status: 400 })
      }
      attrs.name = name
    }
    if (typeof body.body === 'string') {
      const messageBody = body.body.trim()
      if (!messageBody) {
        return NextResponse.json({ error: 'Message body cannot be empty.' }, { status: 400 })
      }
      if (messageBody.length > 2000) {
        return NextResponse.json({ error: 'Message body must be 2000 characters or less.' }, { status: 400 })
      }
      attrs.body = messageBody
    }

    if (Object.keys(attrs).length === 0) {
      return NextResponse.json({ error: 'No fields to update.' }, { status: 400 })
    }

    const template = await updateDiscordBroadcastTemplate(id, attrs)
    if (!template) {
      return NextResponse.json({ error: 'Failed to update template.' }, { status: 500 })
    }

    return NextResponse.json(template)
  } catch (error) {
    console.error('PATCH /api/admin/discord-broadcast/templates/[id]:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: 'Template id required.' }, { status: 400 })
    }

    const ok = await deleteDiscordBroadcastTemplate(id)
    if (!ok) {
      return NextResponse.json({ error: 'Failed to delete template.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/admin/discord-broadcast/templates/[id]:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
