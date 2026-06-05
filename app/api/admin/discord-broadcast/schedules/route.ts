import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  parseOptionalIsoDate,
  parseScheduleTimingInput,
  parseSnoozeUntil,
} from '@/lib/discord-broadcast/parse-schedule-input'
import { createDiscordBroadcastSchedule, getDiscordBroadcastTemplate } from '@/lib/db/discord-broadcast'
import { safeErrorMessage } from '@/lib/safe-error'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const body = await request.json().catch(() => ({}))
    const templateId = typeof body.template_id === 'string' ? body.template_id.trim() : ''
    if (!templateId) {
      return NextResponse.json({ error: 'template_id is required.' }, { status: 400 })
    }

    const template = await getDiscordBroadcastTemplate(templateId)
    if (!template) {
      return NextResponse.json({ error: 'Template not found.' }, { status: 404 })
    }

    const postToPublic = body.post_to_public !== false
    const postToHolder = body.post_to_holder === true
    if (!postToPublic && !postToHolder) {
      return NextResponse.json({ error: 'Select at least one channel.' }, { status: 400 })
    }

    const timing = parseScheduleTimingInput(body)
    if (!timing.ok) {
      return NextResponse.json({ error: timing.error }, { status: 400 })
    }

    const postsPerDayRaw = Number.parseInt(String(body.posts_per_day ?? 1), 10)
    const postsPerDay =
      Number.isFinite(postsPerDayRaw) && postsPerDayRaw >= 1 && postsPerDayRaw <= 10
        ? postsPerDayRaw
        : 1

    const label = typeof body.label === 'string' ? body.label.trim() : template.name
    const campaignStart = parseOptionalIsoDate(body.campaign_start)
    const campaignEnd = parseOptionalIsoDate(body.campaign_end)
    const snoozeUntil = parseSnoozeUntil(body, timing.timezone)

    const schedule = await createDiscordBroadcastSchedule({
      template_id: templateId,
      label: label || template.name,
      post_to_public: postToPublic,
      post_to_holder: postToHolder,
      schedule_type: timing.schedule_type,
      timezone: timing.timezone,
      once_at: timing.once_at,
      local_hour: timing.local_hour,
      local_minute: timing.local_minute,
      days_of_week: timing.days_of_week,
      posts_per_day: postsPerDay,
      active: body.active !== false,
      snooze_until: snoozeUntil,
      campaign_start: campaignStart,
      campaign_end: campaignEnd,
      created_by_wallet: session.wallet,
    })

    if (!schedule) {
      return NextResponse.json({ error: 'Failed to create schedule.' }, { status: 500 })
    }

    return NextResponse.json(schedule)
  } catch (error) {
    console.error('POST /api/admin/discord-broadcast/schedules:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
