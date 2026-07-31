import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

export interface RevShareSchedule {
  /** Legacy site-wide date; kept in sync with Gen 1 so older clients keep working. */
  next_date: string | null
  gen1_next_date: string | null
  gen2_next_date: string | null
  total_sol: number | null
  total_usdc: number | null
  gen1_total_sol: number | null
  gen1_total_usdc: number | null
  gen2_total_sol: number | null
  gen2_total_usdc: number | null
  /** When false, Gen nest rev-share claim buttons / payouts are off (admin kill switch). */
  claims_enabled: boolean
  updated_at: string
}

const ROW_ID = 'default'

const SELECT_COLUMNS =
  'next_date, gen1_next_date, gen2_next_date, total_sol, total_usdc, gen1_total_sol, gen1_total_usdc, gen2_total_sol, gen2_total_usdc, claims_enabled, updated_at'

function mapRow(data: Record<string, unknown>): RevShareSchedule {
  const num = (v: unknown) => (v != null ? Number(v) : null)
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
  const nextDate = text(data.next_date)
  return {
    next_date: nextDate,
    gen1_next_date: text(data.gen1_next_date) ?? nextDate,
    gen2_next_date: text(data.gen2_next_date) ?? nextDate,
    total_sol: num(data.total_sol),
    total_usdc: num(data.total_usdc),
    gen1_total_sol: num(data.gen1_total_sol),
    gen1_total_usdc: num(data.gen1_total_usdc),
    gen2_total_sol: num(data.gen2_total_sol),
    gen2_total_usdc: num(data.gen2_total_usdc),
    // Default on if column missing / null (older rows before migration).
    claims_enabled: data.claims_enabled !== false,
    updated_at: typeof data.updated_at === 'string' ? data.updated_at : new Date().toISOString(),
  }
}

/**
 * Fetch the current rev share schedule (public).
 */
export async function getRevShareSchedule(): Promise<RevShareSchedule | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('rev_share_schedule')
    .select(SELECT_COLUMNS)
    .eq('id', ROW_ID)
    .single()

  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

/** Admin kill switch — false means claim APIs must reject. Missing schedule → treat as enabled. */
export async function areGenOwlRevShareClaimsEnabled(): Promise<boolean> {
  const schedule = await getRevShareSchedule()
  return schedule?.claims_enabled !== false
}

/**
 * Update the rev share schedule (admin only; use service role).
 */
export async function updateRevShareSchedule(updates: {
  next_date?: string | null
  gen1_next_date?: string | null
  gen2_next_date?: string | null
  total_sol?: number | null
  total_usdc?: number | null
  gen1_total_sol?: number | null
  gen1_total_usdc?: number | null
  gen2_total_sol?: number | null
  gen2_total_usdc?: number | null
  claims_enabled?: boolean
}): Promise<RevShareSchedule | null> {
  const db = getSupabaseAdmin()
  const payload: Record<string, unknown> = {}
  if (updates.next_date !== undefined) payload.next_date = updates.next_date
  if (updates.gen1_next_date !== undefined) payload.gen1_next_date = updates.gen1_next_date
  if (updates.gen2_next_date !== undefined) payload.gen2_next_date = updates.gen2_next_date
  if (updates.total_sol !== undefined) payload.total_sol = updates.total_sol
  if (updates.total_usdc !== undefined) payload.total_usdc = updates.total_usdc
  if (updates.gen1_total_sol !== undefined) payload.gen1_total_sol = updates.gen1_total_sol
  if (updates.gen1_total_usdc !== undefined) payload.gen1_total_usdc = updates.gen1_total_usdc
  if (updates.gen2_total_sol !== undefined) payload.gen2_total_sol = updates.gen2_total_sol
  if (updates.gen2_total_usdc !== undefined) payload.gen2_total_usdc = updates.gen2_total_usdc
  if (updates.claims_enabled !== undefined) payload.claims_enabled = updates.claims_enabled

  const { data, error } = await db
    .from('rev_share_schedule')
    .update(payload)
    .eq('id', ROW_ID)
    .select(SELECT_COLUMNS)
    .single()

  if (error) {
    console.error('Error updating rev share schedule:', error)
    return null
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}
