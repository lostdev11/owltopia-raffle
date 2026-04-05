import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { removeDevTaskScreenshotPaths, screenshotUrlsFromPaths } from '@/lib/dev-task-storage'
import type { DevTask } from './dev-tasks-model'
import { DEV_TASK_MAX_SCREENSHOTS_TOTAL } from './dev-tasks-model'

export type { DevTask } from './dev-tasks-model'
export { DEV_TASK_MAX_SCREENSHOTS_TOTAL } from './dev-tasks-model'

function hydrateDevTask(row: {
  id: string
  title: string
  body: string | null
  status: string
  created_by: string
  created_at: string
  updated_at: string
  completed_at: string | null
  screenshot_paths?: string[] | null
}): DevTask {
  const paths = Array.isArray(row.screenshot_paths) ? row.screenshot_paths : []
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status as 'open' | 'done',
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    screenshot_paths: paths,
    screenshot_urls: screenshotUrlsFromPaths(paths),
  }
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
  return (data || []).map((row) => hydrateDevTask(row as Parameters<typeof hydrateDevTask>[0]))
}

export async function createDevTask(attrs: {
  title: string
  body?: string | null
  created_by: string
  screenshot_paths?: string[]
}): Promise<DevTask | null> {
  const paths = attrs.screenshot_paths?.length ? attrs.screenshot_paths : []
  const { data, error } = await getSupabaseAdmin()
    .from('dev_tasks')
    .insert({
      title: attrs.title.trim(),
      body: attrs.body?.trim() ? attrs.body.trim() : null,
      created_by: attrs.created_by.trim(),
      status: 'open',
      screenshot_paths: paths,
    })
    .select()
    .single()

  if (error) {
    console.error('createDevTask:', error)
    return null
  }
  return hydrateDevTask(data as Parameters<typeof hydrateDevTask>[0])
}

export async function updateDevTask(
  id: string,
  attrs: Partial<{
    title: string
    body: string | null
    status: 'open' | 'done'
    screenshot_paths: string[]
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
  if (attrs.screenshot_paths !== undefined) {
    patch.screenshot_paths = attrs.screenshot_paths
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
  return hydrateDevTask(data as Parameters<typeof hydrateDevTask>[0])
}

export async function getDevTaskScreenshotPathCount(id: string): Promise<number | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('dev_tasks')
    .select('screenshot_paths')
    .eq('id', id)
    .single()

  if (error || !data) return null
  const p = data.screenshot_paths as string[] | null | undefined
  return Array.isArray(p) ? p.length : 0
}

export async function appendDevTaskScreenshotPaths(id: string, newPaths: string[]): Promise<DevTask | null> {
  if (newPaths.length === 0) {
    const { data, error } = await getSupabaseAdmin().from('dev_tasks').select('*').eq('id', id).single()
    if (error || !data) return null
    return hydrateDevTask(data as Parameters<typeof hydrateDevTask>[0])
  }

  const admin = getSupabaseAdmin()
  const { data: row, error: fetchErr } = await admin.from('dev_tasks').select('screenshot_paths').eq('id', id).single()
  if (fetchErr || !row) return null

  const current = Array.isArray(row.screenshot_paths) ? (row.screenshot_paths as string[]) : []
  const merged = [...current, ...newPaths]
  if (merged.length > DEV_TASK_MAX_SCREENSHOTS_TOTAL) return null

  return updateDevTask(id, { screenshot_paths: merged })
}

export async function deleteDevTask(id: string): Promise<boolean> {
  const admin = getSupabaseAdmin()
  const { data: row } = await admin.from('dev_tasks').select('screenshot_paths').eq('id', id).maybeSingle()
  const paths = row?.screenshot_paths as string[] | undefined
  if (paths?.length) {
    await removeDevTaskScreenshotPaths(paths)
  }
  const { error } = await admin.from('dev_tasks').delete().eq('id', id)
  if (error) {
    console.error('deleteDevTask:', error)
    return false
  }
  return true
}
