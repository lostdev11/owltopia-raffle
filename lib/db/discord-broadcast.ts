import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type DiscordBroadcastTemplate = {
  id: string
  name: string
  body: string
  mention_everyone: boolean
  created_by_wallet: string | null
  created_at: string
  updated_at: string
}

export type DiscordBroadcastScheduleType = 'once' | 'recurring'

export type DiscordBroadcastSchedule = {
  id: string
  template_id: string
  label: string
  post_to_public: boolean
  post_to_holder: boolean
  schedule_type: DiscordBroadcastScheduleType
  timezone: string
  once_at: string | null
  local_hour: number | null
  local_minute: number | null
  days_of_week: number[]
  posts_per_day: number
  active: boolean
  snooze_until: string | null
  campaign_start: string | null
  campaign_end: string | null
  last_run_at: string | null
  last_run_local_date: string | null
  posts_sent_on_last_run_date: number
  once_completed: boolean
  created_by_wallet: string | null
  created_at: string
  updated_at: string
}

export type DiscordBroadcastScheduleWithTemplate = DiscordBroadcastSchedule & {
  template: DiscordBroadcastTemplate | null
}

export type DiscordBroadcastSendLog = {
  id: string
  schedule_id: string | null
  template_id: string | null
  body_snapshot: string
  post_to_public: boolean
  post_to_holder: boolean
  status: 'sent' | 'partial' | 'failed'
  error_message: string | null
  triggered_by: 'cron' | 'manual'
  created_by_wallet: string | null
  created_at: string
}

export async function listDiscordBroadcastTemplates(): Promise<DiscordBroadcastTemplate[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_templates')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('listDiscordBroadcastTemplates:', error)
    return []
  }
  return (data ?? []) as DiscordBroadcastTemplate[]
}

export async function getDiscordBroadcastTemplate(
  id: string
): Promise<DiscordBroadcastTemplate | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_templates')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('getDiscordBroadcastTemplate:', error)
    return null
  }
  return (data as DiscordBroadcastTemplate) ?? null
}

export async function createDiscordBroadcastTemplate(attrs: {
  name: string
  body: string
  mention_everyone?: boolean
  created_by_wallet?: string | null
}): Promise<DiscordBroadcastTemplate | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_templates')
    .insert({
      name: attrs.name,
      body: attrs.body,
      mention_everyone: attrs.mention_everyone === true,
      created_by_wallet: attrs.created_by_wallet ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('createDiscordBroadcastTemplate:', error)
    return null
  }
  return data as DiscordBroadcastTemplate
}

export async function updateDiscordBroadcastTemplate(
  id: string,
  attrs: Partial<{ name: string; body: string; mention_everyone: boolean }>
): Promise<DiscordBroadcastTemplate | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_templates')
    .update(attrs)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('updateDiscordBroadcastTemplate:', error)
    return null
  }
  return data as DiscordBroadcastTemplate
}

export async function deleteDiscordBroadcastTemplate(id: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin().from('discord_broadcast_templates').delete().eq('id', id)
  if (error) {
    console.error('deleteDiscordBroadcastTemplate:', error)
    return false
  }
  return true
}

export async function listDiscordBroadcastSchedules(): Promise<DiscordBroadcastScheduleWithTemplate[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_schedules')
    .select('*, template:discord_broadcast_templates(*)')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listDiscordBroadcastSchedules:', error)
    return []
  }

  return (data ?? []).map((row) => {
    const { template, ...schedule } = row as DiscordBroadcastSchedule & {
      template: DiscordBroadcastTemplate | DiscordBroadcastTemplate[] | null
    }
    const t = Array.isArray(template) ? template[0] : template
    return { ...schedule, template: t ?? null }
  })
}

export async function getDiscordBroadcastSchedule(
  id: string
): Promise<DiscordBroadcastScheduleWithTemplate | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_schedules')
    .select('*, template:discord_broadcast_templates(*)')
    .eq('id', id)
    .maybeSingle()

  if (error || !data) {
    console.error('getDiscordBroadcastSchedule:', error)
    return null
  }

  const { template, ...schedule } = data as DiscordBroadcastSchedule & {
    template: DiscordBroadcastTemplate | DiscordBroadcastTemplate[] | null
  }
  const t = Array.isArray(template) ? template[0] : template
  return { ...schedule, template: t ?? null }
}

export async function createDiscordBroadcastSchedule(
  attrs: Omit<
    DiscordBroadcastSchedule,
    | 'id'
    | 'last_run_at'
    | 'last_run_local_date'
    | 'posts_sent_on_last_run_date'
    | 'once_completed'
    | 'created_at'
    | 'updated_at'
  > & { created_by_wallet?: string | null }
): Promise<DiscordBroadcastSchedule | null> {
  const { created_by_wallet, ...rest } = attrs
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_schedules')
    .insert({
      ...rest,
      created_by_wallet: created_by_wallet ?? null,
    })
    .select()
    .single()

  if (error) {
    console.error('createDiscordBroadcastSchedule:', error)
    return null
  }
  return data as DiscordBroadcastSchedule
}

export async function updateDiscordBroadcastSchedule(
  id: string,
  attrs: Partial<
    Omit<DiscordBroadcastSchedule, 'id' | 'created_at' | 'updated_at' | 'template_id'> & {
      template_id?: string
    }
  >
): Promise<DiscordBroadcastSchedule | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_schedules')
    .update(attrs)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('updateDiscordBroadcastSchedule:', error)
    return null
  }
  return data as DiscordBroadcastSchedule
}

export async function deleteDiscordBroadcastSchedule(id: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin().from('discord_broadcast_schedules').delete().eq('id', id)
  if (error) {
    console.error('deleteDiscordBroadcastSchedule:', error)
    return false
  }
  return true
}

export async function listActiveDiscordBroadcastSchedules(): Promise<DiscordBroadcastScheduleWithTemplate[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_schedules')
    .select('*, template:discord_broadcast_templates(*)')
    .eq('active', true)
    .eq('once_completed', false)

  if (error) {
    console.error('listActiveDiscordBroadcastSchedules:', error)
    return []
  }

  return (data ?? []).map((row) => {
    const { template, ...schedule } = row as DiscordBroadcastSchedule & {
      template: DiscordBroadcastTemplate | DiscordBroadcastTemplate[] | null
    }
    const t = Array.isArray(template) ? template[0] : template
    return { ...schedule, template: t ?? null }
  })
}

export async function markDiscordBroadcastScheduleRan(
  id: string,
  attrs: {
    last_run_at: string
    last_run_local_date: string | null
    posts_sent_on_last_run_date: number
    once_completed?: boolean
  }
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('discord_broadcast_schedules')
    .update({
      last_run_at: attrs.last_run_at,
      last_run_local_date: attrs.last_run_local_date,
      posts_sent_on_last_run_date: attrs.posts_sent_on_last_run_date,
      ...(attrs.once_completed !== undefined ? { once_completed: attrs.once_completed } : {}),
    })
    .eq('id', id)

  if (error) {
    console.error('markDiscordBroadcastScheduleRan:', error)
  }
}

export async function insertDiscordBroadcastSendLog(attrs: {
  schedule_id?: string | null
  template_id?: string | null
  body_snapshot: string
  post_to_public: boolean
  post_to_holder: boolean
  status: 'sent' | 'partial' | 'failed'
  error_message?: string | null
  triggered_by: 'cron' | 'manual'
  created_by_wallet?: string | null
}): Promise<void> {
  const { error } = await getSupabaseAdmin().from('discord_broadcast_send_log').insert({
    schedule_id: attrs.schedule_id ?? null,
    template_id: attrs.template_id ?? null,
    body_snapshot: attrs.body_snapshot,
    post_to_public: attrs.post_to_public,
    post_to_holder: attrs.post_to_holder,
    status: attrs.status,
    error_message: attrs.error_message ?? null,
    triggered_by: attrs.triggered_by,
    created_by_wallet: attrs.created_by_wallet ?? null,
  })
  if (error) {
    console.error('insertDiscordBroadcastSendLog:', error)
  }
}

export async function listRecentDiscordBroadcastSendLogs(limit = 30): Promise<DiscordBroadcastSendLog[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_broadcast_send_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('listRecentDiscordBroadcastSendLogs:', error)
    return []
  }
  return (data ?? []) as DiscordBroadcastSendLog[]
}
