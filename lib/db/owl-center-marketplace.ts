import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { OwlCenterMarketplaceReadiness } from '@/lib/owl-center/asset-types'

const TERMINAL_STATUSES = ['LISTED', 'CLAIMED', 'VERIFIED'] as const

function isTerminalStatus(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status)
}

function mapMarketplaceRow(row: Record<string, unknown>): OwlCenterMarketplaceReadiness {
  return {
    id: String(row.id),
    launch_id: String(row.launch_id),
    collection_mint: row.collection_mint != null ? String(row.collection_mint) : null,
    candy_machine_id: row.candy_machine_id != null ? String(row.candy_machine_id) : null,
    hash_list_url: row.hash_list_url != null ? String(row.hash_list_url) : null,
    hash_list_text: row.hash_list_text != null ? String(row.hash_list_text) : null,
    sellout_prepared_at: row.sellout_prepared_at != null ? String(row.sellout_prepared_at) : null,
    magic_eden_url: row.magic_eden_url != null ? String(row.magic_eden_url) : null,
    tensor_url: row.tensor_url != null ? String(row.tensor_url) : null,
    orbis_url: row.orbis_url != null ? String(row.orbis_url) : null,
    metadata_status: String(row.metadata_status ?? 'NOT_READY') as OwlCenterMarketplaceReadiness['metadata_status'],
    verified_collection_status: String(row.verified_collection_status ?? 'NOT_READY') as OwlCenterMarketplaceReadiness['verified_collection_status'],
    magic_eden_status: String(row.magic_eden_status ?? 'NOT_READY') as OwlCenterMarketplaceReadiness['magic_eden_status'],
    tensor_status: String(row.tensor_status ?? 'NOT_READY') as OwlCenterMarketplaceReadiness['tensor_status'],
    orbis_status: String(row.orbis_status ?? 'NOT_READY') as OwlCenterMarketplaceReadiness['orbis_status'],
    trading_links_active: Boolean(row.trading_links_active),
    notes: row.notes != null ? String(row.notes) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

export async function getMarketplaceReadinessByLaunchId(launchId: string): Promise<OwlCenterMarketplaceReadiness | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_marketplace_readiness')
    .select('*')
    .eq('launch_id', launchId)
    .maybeSingle()
  if (error || !data) return null
  return mapMarketplaceRow(data as Record<string, unknown>)
}

export async function upsertMarketplaceReadinessForLaunch(
  launchId: string,
  patch: Partial<{
    collection_mint: string | null
    candy_machine_id: string | null
    hash_list_url: string | null
    hash_list_text: string | null
    sellout_prepared_at: string | null
    magic_eden_url: string | null
    tensor_url: string | null
    orbis_url: string | null
    metadata_status: OwlCenterMarketplaceReadiness['metadata_status']
    verified_collection_status: OwlCenterMarketplaceReadiness['verified_collection_status']
    magic_eden_status: OwlCenterMarketplaceReadiness['magic_eden_status']
    tensor_status: OwlCenterMarketplaceReadiness['tensor_status']
    orbis_status: OwlCenterMarketplaceReadiness['orbis_status']
    trading_links_active: boolean
    notes: string | null
  }>
): Promise<OwlCenterMarketplaceReadiness | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_marketplace_readiness')
    .upsert(
      {
        launch_id: launchId,
        ...patch,
      },
      { onConflict: 'launch_id' }
    )
    .select('*')
    .single()
  if (error || !data) {
    console.error('upsertMarketplaceReadinessForLaunch', error)
    return null
  }
  return mapMarketplaceRow(data as Record<string, unknown>)
}

export async function ensureMarketplaceRow(launchId: string): Promise<OwlCenterMarketplaceReadiness | null> {
  const existing = await getMarketplaceReadinessByLaunchId(launchId)
  if (existing) return existing
  return upsertMarketplaceReadinessForLaunch(launchId, {})
}

/** Mirror URLs + readiness to owl_center_launches (application-side; complements SQL RPC). */
export async function syncLaunchMarketplaceFieldsFromRow(
  launchId: string,
  row: OwlCenterMarketplaceReadiness
): Promise<void> {
  const db = getSupabaseAdmin()
  const meOk = isTerminalStatus(row.magic_eden_status)
  const teOk = isTerminalStatus(row.tensor_status)
  const orbisOk = isTerminalStatus(row.orbis_status)
  // Orbis alone can mark ready; legacy path still requires ME + Tensor together.
  const marketplace_ready = orbisOk || (meOk && teOk)

  const me = row.magic_eden_url?.trim() || null
  const te = row.tensor_url?.trim() || null
  const orbis = row.orbis_url?.trim() || null
  const hasAnyUrl = Boolean(me || te || orbis)
  const shouldMirrorUrls = row.trading_links_active || hasAnyUrl

  const launchPatch: Record<string, unknown> = {
    marketplace_ready,
    updated_at: new Date().toISOString(),
  }
  if (row.collection_mint?.trim()) launchPatch.collection_mint = row.collection_mint.trim()
  if (row.candy_machine_id?.trim()) launchPatch.candy_machine_id = row.candy_machine_id.trim()
  if (shouldMirrorUrls) {
    launchPatch.magic_eden_url = me
    launchPatch.tensor_url = te
    launchPatch.orbis_url = orbis
  }

  await db.from('owl_center_launches').update(launchPatch).eq('id', launchId)
}

export async function rpcUpdateMarketplaceReadiness(
  launchId: string,
  magicEdenStatus: OwlCenterMarketplaceReadiness['magic_eden_status'],
  tensorStatus: OwlCenterMarketplaceReadiness['tensor_status'],
  magicEdenUrl?: string | null,
  tensorUrl?: string | null
): Promise<boolean> {
  const db = getSupabaseAdmin()
  const { error } = await db.rpc('update_marketplace_readiness', {
    p_launch_id: launchId,
    p_magic_eden_status: magicEdenStatus,
    p_tensor_status: tensorStatus,
    p_magic_eden_url: magicEdenUrl ?? null,
    p_tensor_url: tensorUrl ?? null,
  })
  if (error) {
    console.error('rpcUpdateMarketplaceReadiness', error)
    return false
  }
  return true
}
