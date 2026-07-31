import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { GenOwlStakingGroupKey } from '@/lib/nesting/gen-owl-staking-groups'
import { GEN1_OWL_STAKING_POOL_SLUGS, GEN2_OWL_STAKING_POOL_SLUGS } from '@/lib/nesting/gen1-staking-pools'

const GROUP_SLUGS: Record<GenOwlStakingGroupKey, readonly string[]> = {
  'gen1-owl': GEN1_OWL_STAKING_POOL_SLUGS,
  'gen2-owl': GEN2_OWL_STAKING_POOL_SLUGS,
}

/** PostgREST caps each response at 1000 rows. */
const MINTS_PAGE_SIZE = 1000

/** Active nests across all lock tiers in a Gen 1 / Gen 2 group (one row per nested NFT). */
export async function countActiveGenOwlNests(group: GenOwlStakingGroupKey): Promise<number> {
  const slugs = [...GROUP_SLUGS[group]]
  const db = getSupabaseAdmin()

  const { data: pools, error: poolError } = await db.from('staking_pools').select('id').in('slug', slugs)
  if (poolError) {
    console.error('[gen-owl-rev-share] pool lookup:', poolError.message)
    return 0
  }

  const poolIds = (pools ?? []).map((p) => p.id).filter(Boolean)
  if (poolIds.length === 0) return 0

  const { count, error } = await db
    .from('staking_positions')
    .select('id', { count: 'exact', head: true })
    .in('pool_id', poolIds)
    .eq('status', 'active')

  if (error) {
    console.error('[gen-owl-rev-share] nest count:', error.message)
    return 0
  }
  return count ?? 0
}

export async function countActiveGenOwlNestsByGroup(): Promise<Record<GenOwlStakingGroupKey, number>> {
  const [gen1, gen2] = await Promise.all([
    countActiveGenOwlNests('gen1-owl'),
    countActiveGenOwlNests('gen2-owl'),
  ])
  return { 'gen1-owl': gen1, 'gen2-owl': gen2 }
}

/** Active nest mint addresses for Gen 1 / Gen 2 rev share bucket previews. */
export async function listActiveGenOwlNestMintsByGroup(
  group: GenOwlStakingGroupKey
): Promise<string[]> {
  const slugs = [...GROUP_SLUGS[group]]
  const db = getSupabaseAdmin()

  const { data: pools, error: poolError } = await db.from('staking_pools').select('id').in('slug', slugs)
  if (poolError) {
    console.error('[gen-owl-rev-share] pool lookup:', poolError.message)
    return []
  }

  const poolIds = (pools ?? []).map((p) => p.id).filter(Boolean)
  if (poolIds.length === 0) return []

  const mints: string[] = []
  for (let offset = 0; ; offset += MINTS_PAGE_SIZE) {
    const { data, error } = await db
      .from('staking_positions')
      .select('asset_identifier')
      .in('pool_id', poolIds)
      .eq('status', 'active')
      .not('asset_identifier', 'is', null)
      .order('staked_at', { ascending: true })
      .range(offset, offset + MINTS_PAGE_SIZE - 1)

    if (error) {
      console.error('[gen-owl-rev-share] nest mints:', error.message)
      return mints
    }

    const page = data ?? []
    for (const row of page) {
      const mint = String((row as { asset_identifier?: string }).asset_identifier ?? '').trim()
      if (mint) mints.push(mint)
    }
    if (page.length < MINTS_PAGE_SIZE) break
  }
  return mints
}
