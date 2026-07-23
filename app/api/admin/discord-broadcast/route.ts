import { NextRequest, NextResponse } from 'next/server'
import { requireAdminSession } from '@/lib/auth-server'
import {
  getDiscordBroadcastChannelConfigDetailed,
  isDiscordBroadcastConfigured,
} from '@/lib/discord-channel-messages'
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
    const session = await requireAdminSession(request)
    if (session instanceof NextResponse) return session

    const [templates, schedules, logs] = await Promise.all([
      listDiscordBroadcastTemplates(),
      listDiscordBroadcastSchedules(),
      listRecentDiscordBroadcastSendLogs(40),
    ])

    return NextResponse.json({
      configured: isDiscordBroadcastConfigured(),
      channels: await getDiscordBroadcastChannelConfigDetailed(),
      templates,
      schedules,
      logs,
    })
  } catch (error) {
    console.error('GET /api/admin/discord-broadcast:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
