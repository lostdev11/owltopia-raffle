import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'

export type GenOwlRevSharePeriodRow = {
  period_month: string
  gen1_total_sol: number | null
  gen1_total_usdc: number | null
  gen2_total_sol: number | null
  gen2_total_usdc: number | null
  gen1_eligible_count: number | null
  gen2_eligible_count: number | null
  gen1_per_nest_sol: number | null
  gen1_per_nest_usdc: number | null
  gen2_per_nest_sol: number | null
  gen2_per_nest_usdc: number | null
  finalized_at: string | null
  updated_at: string
}

function mapPeriodRow(data: Record<string, unknown>): GenOwlRevSharePeriodRow {
  return {
    period_month: String(data.period_month),
    gen1_total_sol: data.gen1_total_sol != null ? Number(data.gen1_total_sol) : null,
    gen1_total_usdc: data.gen1_total_usdc != null ? Number(data.gen1_total_usdc) : null,
    gen2_total_sol: data.gen2_total_sol != null ? Number(data.gen2_total_sol) : null,
    gen2_total_usdc: data.gen2_total_usdc != null ? Number(data.gen2_total_usdc) : null,
    gen1_eligible_count: data.gen1_eligible_count != null ? Number(data.gen1_eligible_count) : null,
    gen2_eligible_count: data.gen2_eligible_count != null ? Number(data.gen2_eligible_count) : null,
    gen1_per_nest_sol: data.gen1_per_nest_sol != null ? Number(data.gen1_per_nest_sol) : null,
    gen1_per_nest_usdc: data.gen1_per_nest_usdc != null ? Number(data.gen1_per_nest_usdc) : null,
    gen2_per_nest_sol: data.gen2_per_nest_sol != null ? Number(data.gen2_per_nest_sol) : null,
    gen2_per_nest_usdc: data.gen2_per_nest_usdc != null ? Number(data.gen2_per_nest_usdc) : null,
    finalized_at: data.finalized_at != null ? String(data.finalized_at) : null,
    updated_at: String(data.updated_at ?? new Date().toISOString()),
  }
}

export async function getGenOwlRevSharePeriod(periodMonth: string): Promise<GenOwlRevSharePeriodRow | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('gen_owl_rev_share_periods')
    .select('*')
    .eq('period_month', periodMonth.trim())
    .maybeSingle()
  if (error || !data) return null
  return mapPeriodRow(data as Record<string, unknown>)
}

export async function listGenOwlRevSharePeriods(limit = 24): Promise<GenOwlRevSharePeriodRow[]> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('gen_owl_rev_share_periods')
    .select('*')
    .order('period_month', { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return data.map((row) => mapPeriodRow(row as Record<string, unknown>))
}

export async function upsertGenOwlRevSharePeriodTotals(input: {
  period_month: string
  gen1_total_sol?: number | null
  gen1_total_usdc?: number | null
  gen2_total_sol?: number | null
  gen2_total_usdc?: number | null
}): Promise<GenOwlRevSharePeriodRow | null> {
  const db = getSupabaseAdmin()
  const payload: Record<string, unknown> = {
    period_month: input.period_month.trim(),
  }
  if (input.gen1_total_sol !== undefined) payload.gen1_total_sol = input.gen1_total_sol
  if (input.gen1_total_usdc !== undefined) payload.gen1_total_usdc = input.gen1_total_usdc
  if (input.gen2_total_sol !== undefined) payload.gen2_total_sol = input.gen2_total_sol
  if (input.gen2_total_usdc !== undefined) payload.gen2_total_usdc = input.gen2_total_usdc

  const { data, error } = await db
    .from('gen_owl_rev_share_periods')
    .upsert(payload, { onConflict: 'period_month' })
    .select('*')
    .single()

  if (error) {
    console.error('[gen-owl-rev-share-periods] upsert:', error.message)
    return null
  }
  return mapPeriodRow(data as Record<string, unknown>)
}

export async function finalizeGenOwlRevSharePeriod(input: {
  period_month: string
  gen1_eligible_count: number
  gen2_eligible_count: number
  gen1_per_nest_sol: number | null
  gen1_per_nest_usdc: number | null
  gen2_per_nest_sol: number | null
  gen2_per_nest_usdc: number | null
}): Promise<GenOwlRevSharePeriodRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('gen_owl_rev_share_periods')
    .update({
      gen1_eligible_count: input.gen1_eligible_count,
      gen2_eligible_count: input.gen2_eligible_count,
      gen1_per_nest_sol: input.gen1_per_nest_sol,
      gen1_per_nest_usdc: input.gen1_per_nest_usdc,
      gen2_per_nest_sol: input.gen2_per_nest_sol,
      gen2_per_nest_usdc: input.gen2_per_nest_usdc,
      finalized_at: new Date().toISOString(),
    })
    .eq('period_month', input.period_month.trim())
    .select('*')
    .single()

  if (error) {
    console.error('[gen-owl-rev-share-periods] finalize:', error.message)
    return null
  }
  return mapPeriodRow(data as Record<string, unknown>)
}
