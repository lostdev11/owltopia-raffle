import { NextRequest, NextResponse } from 'next/server'
import { requireFullAdminSession } from '@/lib/auth-server'
import {
  parseOptionalIsoDate,
  parseScheduleTimingInput,
  parseSnoozeUntil,
} from '@/lib/discord-broadcast/parse-schedule-input'
import {
  deleteDiscordBroadcastSchedule,
  updateDiscordBroadcastSchedule,
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
      return NextResponse.json({ error: 'Schedule id required.' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const attrs: Record<string, unknown> = {}

    if (typeof body.label === 'string') attrs.label = body.label.trim()
    if (typeof body.template_id === 'string') attrs.template_id = body.template_id.trim()
    if (typeof body.post_to_public === 'boolean') attrs.post_to_public = body.post_to_public
    if (typeof body.post_to_holder === 'boolean') attrs.post_to_holder = body.post_to_holder
    if (typeof body.active === 'boolean') attrs.active = body.active

    if (body.clear_snooze === true) {
      attrs.snooze_until = null
    }

    if (body.schedule_type || body.timezone || body.once_date || body.recurring_time) {
      const timing = parseScheduleTimingInput({
        schedule_type: body.schedule_type,
        timezone: body.timezone,
        once_date: body.once_date,
        once_time: body.once_time,
        recurring_time: body.recurring_time,
        days_of_week: body.days_of_week,
      })
      if (!timing.ok) {
        return NextResponse.json({ error: timing.error }, { status: 400 })
      }
      attrs.schedule_type = timing.schedule_type
      attrs.timezone = timing.timezone
      attrs.once_at = timing.once_at
      attrs.local_hour = timing.local_hour
      attrs.local_minute = timing.local_minute
      attrs.days_of_week = timing.days_of_week
    }

    if (body.posts_per_day != null) {
      const n = Number.parseInt(String(body.posts_per_day), 10)
      if (Number.isFinite(n) && n >= 1 && n <= 10) attrs.posts_per_day = n
    }

    if (body.campaign_start !== undefined) {
      attrs.campaign_start = parseOptionalIsoDate(body.campaign_start)
    }
    if (body.campaign_end !== undefined) {
      attrs.campaign_end = parseOptionalIsoDate(body.campaign_end)
    }

    const tzForSnooze =
      typeof attrs.timezone === 'string'
        ? attrs.timezone
        : typeof body.timezone === 'string'
          ? body.timezone
          : 'UTC'

    if (body.snooze_until_date || body.snooze_until_time) {
      attrs.snooze_until = parseSnoozeUntil(body, tzForSnooze)
    }

    if (Object.keys(attrs).length === 0) {
      return NextResponse.json({ error: 'No fields to update.' }, { status: 400 })
    }

    const schedule = await updateDiscordBroadcastSchedule(id, attrs)
    if (!schedule) {
      return NextResponse.json({ error: 'Failed to update schedule.' }, { status: 500 })
    }

    return NextResponse.json(schedule)
  } catch (error) {
    console.error('PATCH /api/admin/discord-broadcast/schedules/[id]:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await requireFullAdminSession(request)
    if (session instanceof NextResponse) return session

    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: 'Schedule id required.' }, { status: 400 })
    }

    const ok = await deleteDiscordBroadcastSchedule(id)
    if (!ok) {
      return NextResponse.json({ error: 'Failed to delete schedule.' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/admin/discord-broadcast/schedules/[id]:', error)
    return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 })
  }
}
