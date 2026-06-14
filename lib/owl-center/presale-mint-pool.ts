import type { OwlCenterPhase } from '@/lib/owl-center/types'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

/** Official presale mint redemption cap in the PRESALE phase (657). */
export const GEN2_PRESALE_MINT_POOL_CAP = 657

export type PresaleMintPoolSnapshot = {
  mint_cap: number
  credits_issued: number
  credits_overshoot: number
  presale_mints_recorded: number
  presale_mints_remaining: number
  overage_supply: number
  overage_mints_recorded: number
  overage_mints_remaining: number
}

export type PresaleWalletMintAllowance = {
  available_mints: number
  used_mints: number
  purchased_mints: number
  gifted_mints: number
  mint_cap: number
  credits_issued: number
  credits_overshoot: number
  global_presale_remaining: number
}

async function sumPresaleCreditsIssuedPaginated(): Promise<number> {
  const db = getSupabaseAdmin()
  const page = 1000
  let from = 0
  let sum = 0
  for (;;) {
    const { data, error } = await db
      .from('gen2_presale_balances')
      .select('purchased_mints,gifted_mints')
      .order('wallet', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const r of rows) {
      const row = r as { purchased_mints?: number; gifted_mints?: number }
      sum += Number(row.purchased_mints ?? 0) + Number(row.gifted_mints ?? 0)
    }
    if (rows.length < page) break
    from += page
  }
  return sum
}

async function sumOwlCenterPresaleCreditsForLaunch(launchId: string): Promise<number> {
  const db = getSupabaseAdmin()
  const { data: tenant, error: tenantErr } = await db
    .from('owl_center_presale_tenants')
    .select('id')
    .eq('launch_id', launchId)
    .maybeSingle()
  if (tenantErr) {
    if (tenantErr.message.includes('launch_id')) return 0
    throw new Error(tenantErr.message)
  }
  if (!tenant) return 0

  const tenantId = String((tenant as { id: string }).id)
  const page = 1000
  let from = 0
  let sum = 0
  for (;;) {
    const { data, error } = await db
      .from('owl_center_presale_balances')
      .select('purchased_mints,gifted_mints')
      .eq('tenant_id', tenantId)
      .order('wallet', { ascending: true })
      .range(from, from + page - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const r of rows) {
      const row = r as { purchased_mints?: number; gifted_mints?: number }
      sum += Number(row.purchased_mints ?? 0) + Number(row.gifted_mints ?? 0)
    }
    if (rows.length < page) break
    from += page
  }
  return sum
}

export async function sumOwlCenterPhaseMinted(
  launchId: string,
  phase: OwlCenterPhase,
  network: 'mainnet' | 'devnet'
): Promise<number> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_mint_events')
    .select('quantity')
    .eq('launch_id', launchId)
    .eq('phase', phase)
    .eq('network', network)
  if (error) throw new Error(error.message)
  return (data ?? []).reduce((s, r) => s + Number((r as { quantity?: number }).quantity ?? 0), 0)
}

export async function sumPresalePhaseMinted(
  launchId: string,
  phase: 'PRESALE' | 'PRESALE_OVERAGE',
  network: 'mainnet' | 'devnet'
): Promise<number> {
  return sumOwlCenterPhaseMinted(launchId, phase, network)
}

export async function getPresaleMintPoolSnapshot(
  launchId: string,
  mintCap: number,
  overageSupply: number,
  network: 'mainnet' | 'devnet',
  options?: { slug?: string }
): Promise<PresaleMintPoolSnapshot> {
  const cap = Math.max(1, Math.floor(mintCap))
  const overageCap = Math.max(0, Math.floor(overageSupply))
  const creditsSource =
    options?.slug === 'gen2'
      ? sumPresaleCreditsIssuedPaginated()
      : sumOwlCenterPresaleCreditsForLaunch(launchId)
  const [credits_issued, presale_mints_recorded, overage_mints_recorded] = await Promise.all([
    creditsSource,
    sumPresalePhaseMinted(launchId, 'PRESALE', network),
    sumPresalePhaseMinted(launchId, 'PRESALE_OVERAGE', network),
  ])
  const credits_overshoot = Math.max(0, credits_issued - cap)
  return {
    mint_cap: cap,
    credits_issued,
    credits_overshoot,
    presale_mints_recorded,
    presale_mints_remaining: Math.max(0, cap - presale_mints_recorded),
    overage_supply: overageCap,
    overage_mints_recorded,
    overage_mints_remaining: Math.max(0, overageCap - overage_mints_recorded),
  }
}

export function buildPresaleWalletAllowance(input: {
  balance: { purchased_mints: number; gifted_mints: number; used_mints: number; available_mints: number } | null
  pool: PresaleMintPoolSnapshot
}): PresaleWalletMintAllowance {
  const bal = input.balance
  const available_mints = bal?.available_mints ?? 0
  return {
    available_mints,
    used_mints: bal?.used_mints ?? 0,
    purchased_mints: bal?.purchased_mints ?? 0,
    gifted_mints: bal?.gifted_mints ?? 0,
    mint_cap: input.pool.mint_cap,
    credits_issued: input.pool.credits_issued,
    credits_overshoot: input.pool.credits_overshoot,
    global_presale_remaining: input.pool.presale_mints_remaining,
  }
}
