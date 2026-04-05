import { getSupabaseAdmin } from '@/lib/supabase-admin'

export interface DevTask {
  id: string
  title: string
  body: string | null
  status: 'open' | 'done'
  created_by: string
  created_at: string
  updated_at: string
  completed_at: string | null
}

export async function listDevTasks(): Promise<DevTask[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('dev_tasks')
    .select('*')
    .order('status', { ascending: false })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listDevTasks:', error)
    return []
  }
  return (data || []) as DevTask[]
}

export async function createDevTask(attrs: {
  title: string
  body?: string | null
  created_by: string
}): Promise<DevTask | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('dev_tasks')
    .insert({
      title: attrs.title.trim(),
      body: attrs.body?.trim() ? attrs.body.trim() : null,
      created_by: attrs.created_by.trim(),
      status: 'open',
    })
    .select()
    .single()

  if (error) {
    console.error('createDevTask:', error)
    return null
  }
  return data as DevTask
}

export async function updateDevTask(
  id: string,
  attrs: Partial<{
    title: string
    body: string | null
    status: 'open' | 'done'
  }>
): Promise<DevTask | null> {
  const patch: Record<string, unknown> = {}
  if (attrs.title !== undefined) patch.title = attrs.title.trim()
  if (attrs.body !== undefined) {
    patch.body = attrs.body === null || attrs.body === '' ? null : String(attrs.body).trim() || null
  }
  if (attrs.status !== undefined) {
    patch.status = attrs.status
    if (attrs.status === 'done') {
      patch.completed_at = new Date().toISOString()
    } else {
      patch.completed_at = null
    }
  }

  const { data, error } = await getSupabaseAdmin()
    .from('dev_tasks')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('updateDevTask:', error)
    return null
  }
  return data as DevTask
}

export async function deleteDevTask(id: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin().from('dev_tasks').delete().eq('id', id)
  if (error) {
    console.error('deleteDevTask:', error)
    return false
  }
  return true
}
