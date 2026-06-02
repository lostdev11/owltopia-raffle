import {
  type BroadcastChannelTarget,
  isDiscordBroadcastConfigured,
  postDiscordBroadcastMessage,
} from '@/lib/discord-channel-messages'
import {
  getLocalTimeParts,
  localDateStringInTimezone,
  zonedLocalDateTimeToUtc,
} from '@/lib/discord-broadcast/timezone'
import {
  insertDiscordBroadcastSendLog,
  listActiveDiscordBroadcastSchedules,
  markDiscordBroadcastScheduleRan,
  type DiscordBroadcastScheduleWithTemplate,
} from '@/lib/db/discord-broadcast'

const CRON_WINDOW_MS = 15 * 60 * 1000
const DEDUPE_MS = 25 * 60 * 1000

export type DiscordBroadcastRunResult = {
  scheduleId: string
  label: string
  status: 'sent' | 'partial' | 'failed' | 'skipped'
  error?: string
}

function scheduleTargets(schedule: DiscordBroadcastScheduleWithTemplate): BroadcastChannelTarget[] {
  const targets: BroadcastChannelTarget[] = []
  if (schedule.post_to_public) targets.push('public')
  if (schedule.post_to_holder) targets.push('holder')
  return targets
}

function isWithinCampaignWindow(schedule: DiscordBroadcastScheduleWithTemplate, now: Date): boolean {
  if (schedule.campaign_start && new Date(schedule.campaign_start).getTime() > now.getTime()) {
    return false
  }
  if (schedule.campaign_end && new Date(schedule.campaign_end).getTime() < now.getTime()) {
    return false
  }
  return true
}

function isSnoozed(schedule: DiscordBroadcastScheduleWithTemplate, now: Date): boolean {
  if (!schedule.snooze_until) return false
  return new Date(schedule.snooze_until).getTime() > now.getTime()
}

function wasRecentlyRun(schedule: DiscordBroadcastScheduleWithTemplate, now: Date): boolean {
  if (!schedule.last_run_at) return false
  return now.getTime() - new Date(schedule.last_run_at).getTime() < DEDUPE_MS
}

function shouldRunOnceSchedule(
  schedule: DiscordBroadcastScheduleWithTemplate,
  now: Date
): boolean {
  if (!schedule.once_at) return false
  const dueAt = new Date(schedule.once_at)
  if (dueAt.getTime() > now.getTime()) return false
  if (schedule.once_completed) return false
  return !wasRecentlyRun(schedule, now)
}

function shouldRunRecurringSchedule(
  schedule: DiscordBroadcastScheduleWithTemplate,
  now: Date
): boolean {
  if (schedule.local_hour == null || schedule.local_minute == null) return false
  if (wasRecentlyRun(schedule, now)) return false

  const local = getLocalTimeParts(now, schedule.timezone)
  const days = schedule.days_of_week?.length ? schedule.days_of_week : [1, 2, 3, 4, 5, 6, 7]
  if (!days.includes(local.isoWeekday)) return false

  const slotUtc = zonedLocalDateTimeToUtc(
    local.year,
    local.month,
    local.day,
    schedule.local_hour,
    schedule.local_minute,
    schedule.timezone
  )
  const delta = now.getTime() - slotUtc.getTime()
  if (delta < 0 || delta > CRON_WINDOW_MS) return false

  const localDate = localDateStringInTimezone(now, schedule.timezone)
  if (
    schedule.last_run_local_date === localDate &&
    schedule.posts_sent_on_last_run_date >= schedule.posts_per_day
  ) {
    return false
  }

  return true
}

function shouldRunSchedule(schedule: DiscordBroadcastScheduleWithTemplate, now: Date): boolean {
  if (!schedule.active) return false
  if (isSnoozed(schedule, now)) return false
  if (!isWithinCampaignWindow(schedule, now)) return false
  if (!schedule.template?.body?.trim()) return false

  if (schedule.schedule_type === 'once') {
    return shouldRunOnceSchedule(schedule, now)
  }
  return shouldRunRecurringSchedule(schedule, now)
}

export async function sendDiscordBroadcastBody(opts: {
  body: string
  postToPublic: boolean
  postToHolder: boolean
  scheduleId?: string | null
  templateId?: string | null
  triggeredBy: 'cron' | 'manual'
  createdByWallet?: string | null
}): Promise<{
  status: 'sent' | 'partial' | 'failed'
  error?: string
  sentTo: BroadcastChannelTarget[]
  failedTo: BroadcastChannelTarget[]
}> {
  const targets: BroadcastChannelTarget[] = []
  if (opts.postToPublic) targets.push('public')
  if (opts.postToHolder) targets.push('holder')

  if (targets.length === 0) {
    return { status: 'failed', error: 'No channels selected.', sentTo: [], failedTo: [] }
  }

  if (!isDiscordBroadcastConfigured()) {
    const err = 'Discord broadcast is not configured (bot token + channel ids).'
    await insertDiscordBroadcastSendLog({
      schedule_id: opts.scheduleId,
      template_id: opts.templateId,
      body_snapshot: opts.body,
      post_to_public: opts.postToPublic,
      post_to_holder: opts.postToHolder,
      status: 'failed',
      error_message: err,
      triggered_by: opts.triggeredBy,
      created_by_wallet: opts.createdByWallet,
    })
    return { status: 'failed', error: err, sentTo: [], failedTo: targets }
  }

  const { results } = await postDiscordBroadcastMessage(opts.body, targets)
  const sentTo = results.filter((r) => r.result.ok).map((r) => r.target)
  const failedTo = results.filter((r) => !r.result.ok).map((r) => r.target)
  const okCount = sentTo.length
  const status: 'sent' | 'partial' | 'failed' =
    okCount === results.length ? 'sent' : okCount > 0 ? 'partial' : 'failed'
  const error = results
    .filter((r) => !r.result.ok)
    .map((r) => `${r.target}: ${r.result.message}`)
    .join('; ')

  await insertDiscordBroadcastSendLog({
    schedule_id: opts.scheduleId,
    template_id: opts.templateId,
    body_snapshot: opts.body,
    post_to_public: opts.postToPublic,
    post_to_holder: opts.postToHolder,
    status,
    error_message: error || null,
    triggered_by: opts.triggeredBy,
    created_by_wallet: opts.createdByWallet,
  })

  return { status, error: error || undefined, sentTo, failedTo }
}

export async function processDueDiscordBroadcastSchedules(): Promise<DiscordBroadcastRunResult[]> {
  const now = new Date()
  const schedules = await listActiveDiscordBroadcastSchedules()
  const results: DiscordBroadcastRunResult[] = []

  for (const schedule of schedules) {
    if (!shouldRunSchedule(schedule, now)) {
      continue
    }

    const body = schedule.template?.body?.trim() ?? ''
    const send = await sendDiscordBroadcastBody({
      body,
      postToPublic: schedule.post_to_public,
      postToHolder: schedule.post_to_holder,
      scheduleId: schedule.id,
      templateId: schedule.template_id,
      triggeredBy: 'cron',
    })

    const localDate =
      schedule.schedule_type === 'recurring'
        ? localDateStringInTimezone(now, schedule.timezone)
        : null

    let postsSentToday = 1
    if (schedule.schedule_type === 'recurring' && localDate) {
      postsSentToday =
        schedule.last_run_local_date === localDate
          ? schedule.posts_sent_on_last_run_date + 1
          : 1
    }

    await markDiscordBroadcastScheduleRan(schedule.id, {
      last_run_at: now.toISOString(),
      last_run_local_date: localDate,
      posts_sent_on_last_run_date: postsSentToday,
      once_completed: schedule.schedule_type === 'once' ? true : undefined,
    })

    results.push({
      scheduleId: schedule.id,
      label: schedule.label || schedule.template?.name || schedule.id,
      status: send.status,
      error: send.error,
    })
  }

  return results
}
