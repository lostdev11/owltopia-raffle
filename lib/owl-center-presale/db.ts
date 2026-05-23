import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { OwlCenterPresaleBalance } from '@/lib/owl-center-presale/types'

export async function sumOwlCenterPresaleSold(tenantId: string): Promise<number> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.rpc('owl_center_presale_sold_confirmed_quantity', { p_tenant_id: tenantId })
  if (error) {
    const { data: rows, error: e2 } = await db
      .from('owl_center_presale_purchases')
      .select('quantity')
      .eq('tenant_id', tenantId)
      .eq('status', 'confirmed')
    if (e2) throw new Error(e2.message)
    let sum = 0
    for (const r of rows ?? []) {
      sum += Number((r as { quantity?: number }).quantity ?? 0)
    }
    return Math.max(0, sum)
  }
  const n = Number(data)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export async function getOwlCenterPresaleBalanceByWallet(
  tenantId: string,
  wallet: string
): Promise<OwlCenterPresaleBalance | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_presale_available_balances')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('wallet', wallet)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const r = data as Record<string, unknown>
  return {
    tenant_id: String(r.tenant_id),
    wallet: String(r.wallet),
    purchased_mints: Number(r.purchased_mints ?? 0),
    gifted_mints: Number(r.gifted_mints ?? 0),
    used_mints: Number(r.used_mints ?? 0),
    available_mints: Number(r.available_mints ?? 0),
  }
}

export function owlCenterPresaleTotalCreditsOnWallet(
  b: Pick<{ purchased_mints: number; gifted_mints: number }, 'purchased_mints' | 'gifted_mints'> | null
): number {
  if (!b) return 0
  const p = Number(b.purchased_mints)
  const g = Number(b.gifted_mints)
  const pi = Number.isFinite(p) ? Math.floor(p) : 0
  const gi = Number.isFinite(g) ? Math.floor(g) : 0
  return Math.max(0, pi + gi)
}

export function owlCenterPresaleCreditsRemainingForWallet(
  b: Pick<{ purchased_mints: number; gifted_mints: number }, 'purchased_mints' | 'gifted_mints'> | null,
  maxCreditsPerWallet: number
): number {
  return Math.max(0, maxCreditsPerWallet - owlCenterPresaleTotalCreditsOnWallet(b))
}
