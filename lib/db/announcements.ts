import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

export interface Announcement {
  id: string
  title: string
  body: string | null
  show_on_hero: boolean
  show_on_raffles: boolean
  mark_as_new: boolean
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

type Placement = 'hero' | 'raffles'

/**
 * Fetch active announcements for a given placement (hero = landing, raffles = raffles page).
 * Used by public API and server components.
 */
export async function getActiveAnnouncements(placement: Placement): Promise<Announcement[]> {
  const db = getSupabaseForServerRead(supabase)
  const col = placement === 'hero' ? 'show_on_hero' : 'show_on_raffles'
  const { data, error } = await db
    .from('announcements')
    .select('*')
    .eq('active', true)
    .eq(col, true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    console.error('Error fetching announcements:', error)
    return []
  }
  return (data || []) as Announcement[]
}

/**
 * Returns true if any active announcement for the given placement has mark_as_new set.
 * Used to show a notification badge on the Announcements tab.
 */
export async function hasNewAnnouncements(placement: Placement): Promise<boolean> {
  const db = getSupabaseForServerRead(supabase)
  const col = placement === 'hero' ? 'show_on_hero' : 'show_on_raffles'
  const { data, error } = await db
    .from('announcements')
    .select('id')
    .eq('active', true)
    .eq(col, true)
    .eq('mark_as_new', true)
    .limit(1)

  if (error) {
    console.error('Error checking new announcements:', error)
    return false
  }
  return (data?.length ?? 0) > 0
}

/**
 * Fetch all announcements (admin). Uses service role to bypass RLS.
 * Returns [] if table does not exist or DB is unavailable.
 */
export async function getAllAnnouncements(): Promise<Announcement[]> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('announcements')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) {
      console.error('Error fetching all announcements:', error)
      return []
    }
    return (data || []) as Announcement[]
  } catch (err) {
    console.error('getAllAnnouncements failed (table may not exist or env missing):', err)
    return []
  }
}

/**
 * Create announcement (admin).
 */
export async function createAnnouncement(attrs: {
  title: string
  body?: string | null
  show_on_hero?: boolean
  show_on_raffles?: boolean
  mark_as_new?: boolean
  active?: boolean
  sort_order?: number
}): Promise<Announcement | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('announcements')
    .insert({
      title: attrs.title,
      body: attrs.body ?? null,
      show_on_hero: attrs.show_on_hero ?? true,
      show_on_raffles: attrs.show_on_raffles ?? true,
      mark_as_new: attrs.mark_as_new ?? false,
      active: attrs.active ?? true,
      sort_order: attrs.sort_order ?? 0,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating announcement:', error)
    return null
  }
  return data as Announcement
}

/**
 * Update announcement (admin).
 */
export async function updateAnnouncement(
  id: string,
  attrs: Partial<{
    title: string
    body: string | null
    show_on_hero: boolean
    show_on_raffles: boolean
    mark_as_new: boolean
    active: boolean
    sort_order: number
  }>
): Promise<Announcement | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('announcements')
    .update(attrs)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error updating announcement:', error)
    return null
  }
  return data as Announcement
}

/**
 * Delete announcement (admin).
 */
export async function deleteAnnouncement(id: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('announcements')
    .delete()
    .eq('id', id)

  if (error) {
    console.error('Error deleting announcement:', error)
    return false
  }
  return true
}
