import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import { isDiscordBroadcastConfigured } from '@/lib/discord-channel-messages'
import {
  listDiscordBroadcastSchedules,
  listDiscordBroadcastTemplates,
  listRecentDiscordBroadcastSendLogs,
} from '@/lib/db/discord-broadcast'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/discord-broadcast
 * Templates, schedules, recent send log, and env config status.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const [templates, schedules, logs] = await Promise.all([
      listDiscordBroadcastTemplates(),
      listDiscordBroadcastSchedules(),
      listRecentDiscordBroadcastSendLogs(40),
    ])

    return NextResponse.json({
      configured: isDiscordBroadcastConfigured(),
      templates,
      schedules,
      logs,
    })
  } catch (error) {
    console.error('GET /api/admin/discord-broadcast:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
