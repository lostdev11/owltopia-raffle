import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

export interface RevShareSchedule {
  next_date: string | null
  total_sol: number | null
  total_usdc: number | null
  updated_at: string
}

const ROW_ID = 'default'

/**
 * Fetch the current rev share schedule (public).
 */
export async function getRevShareSchedule(): Promise<RevShareSchedule | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('rev_share_schedule')
    .select('next_date, total_sol, total_usdc, updated_at')
    .eq('id', ROW_ID)
    .single()

  if (error || !data) return null
  return {
    next_date: data.next_date ?? null,
    total_sol: data.total_sol != null ? Number(data.total_sol) : null,
    total_usdc: data.total_usdc != null ? Number(data.total_usdc) : null,
    updated_at: data.updated_at ?? new Date().toISOString(),
  }
}

/**
 * Update the rev share schedule (admin only; use service role).
 */
export async function updateRevShareSchedule(updates: {
  next_date?: string | null
  total_sol?: number | null
  total_usdc?: number | null
}): Promise<RevShareSchedule | null> {
  const db = getSupabaseAdmin()
  const payload: Record<string, unknown> = {}
  if (updates.next_date !== undefined) payload.next_date = updates.next_date
  if (updates.total_sol !== undefined) payload.total_sol = updates.total_sol
  if (updates.total_usdc !== undefined) payload.total_usdc = updates.total_usdc

  const { data, error } = await db
    .from('rev_share_schedule')
    .update(payload)
    .eq('id', ROW_ID)
    .select('next_date, total_sol, total_usdc, updated_at')
    .single()

  if (error) {
    console.error('Error updating rev share schedule:', error)
    return null
  }
  if (!data) return null
  return {
    next_date: data.next_date ?? null,
    total_sol: data.total_sol != null ? Number(data.total_sol) : null,
    total_usdc: data.total_usdc != null ? Number(data.total_usdc) : null,
    updated_at: data.updated_at ?? new Date().toISOString(),
  }
}
