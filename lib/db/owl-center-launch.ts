import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import type { OwlCenterLaunchPublic, OwlCenterPhase, OwlCenterStatus } from '@/lib/owl-center/types'

function mapRow(data: Record<string, unknown>): OwlCenterLaunchPublic {
  return {
    id: String(data.id),
    slug: String(data.slug),
    name: String(data.name),
    symbol: data.symbol != null ? String(data.symbol) : null,
    description: data.description != null ? String(data.description) : null,
    image_url: data.image_url != null ? String(data.image_url) : null,
    creator_wallet: data.creator_wallet != null ? String(data.creator_wallet) : null,
    candy_machine_id: data.candy_machine_id != null ? String(data.candy_machine_id) : null,
    collection_mint: data.collection_mint != null ? String(data.collection_mint) : null,
    devnet_candy_machine_id:
      data.devnet_candy_machine_id != null ? String(data.devnet_candy_machine_id) : null,
    devnet_collection_mint: data.devnet_collection_mint != null ? String(data.devnet_collection_mint) : null,
    mint_standard: String(data.mint_standard ?? 'token_metadata'),
    total_supply: Number(data.total_supply ?? 0),
    minted_count: Number(data.minted_count ?? 0),
    active_phase: String(data.active_phase) as OwlCenterPhase,
    status: String(data.status) as OwlCenterStatus,
    presale_supply: Number(data.presale_supply ?? 0),
    wl_supply: Number(data.wl_supply ?? 0),
    public_supply: Number(data.public_supply ?? 0),
    airdrop_supply: Number(data.airdrop_supply ?? 0),
    presale_price_usdc: data.presale_price_usdc != null ? Number(data.presale_price_usdc) : null,
    wl_price_usdc: data.wl_price_usdc != null ? Number(data.wl_price_usdc) : null,
    public_price_usdc: data.public_price_usdc != null ? Number(data.public_price_usdc) : null,
    wallet_mint_limit: Number(data.wallet_mint_limit ?? 1),
    magic_eden_url: data.magic_eden_url != null ? String(data.magic_eden_url) : null,
    tensor_url: data.tensor_url != null ? String(data.tensor_url) : null,
    is_featured: Boolean(data.is_featured),
    is_paused: Boolean(data.is_paused),
    launch_deadline_at: data.launch_deadline_at != null ? String(data.launch_deadline_at) : null,
    updated_at: String(data.updated_at ?? ''),
    metadata_ready: Boolean(data.metadata_ready),
    assets_ready: Boolean(data.assets_ready),
    marketplace_ready: Boolean(data.marketplace_ready),
    treasury_wallet: data.treasury_wallet != null ? String(data.treasury_wallet) : null,
    creator_presale_enabled: Boolean(data.creator_presale_enabled),
    creator_wl_enabled: Boolean(data.creator_wl_enabled),
    creator_mint_price:
      data.creator_mint_price != null && data.creator_mint_price !== ''
        ? Number(data.creator_mint_price)
        : null,
    creator_mint_currency: data.creator_mint_currency != null ? String(data.creator_mint_currency) : null,
    creator_launch_date: data.creator_launch_date != null ? String(data.creator_launch_date) : null,
  }
}

export async function getOwlCenterLaunchBySlug(slug: string): Promise<OwlCenterLaunchPublic | null> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db.from('owl_center_launches').select('*').eq('slug', slug).maybeSingle()
  if (error || !data) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('owl_center_launches:', error?.message ?? 'no row')
    }
    return null
  }
  return mapRow(data as Record<string, unknown>)
}

export async function listOwlCenterLaunchesPublic(): Promise<OwlCenterLaunchPublic[]> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('owl_center_launches')
    .select('*')
    .not('status', 'eq', 'DRAFT')
    .not('status', 'eq', 'PENDING_REVIEW')
    .order('is_featured', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapRow)
}

/** Admin/service writes — full row including draft if needed. */
export async function getOwlCenterLaunchBySlugAdmin(slug: string): Promise<OwlCenterLaunchPublic | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_launches').select('*').eq('slug', slug).maybeSingle()
  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function getOwlCenterLaunchByIdAdmin(id: string): Promise<OwlCenterLaunchPublic | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('owl_center_launches').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function updateOwlCenterLaunchAdmin(
  slug: string,
  patch: Partial<{
    active_phase: OwlCenterPhase
    status: OwlCenterStatus
    is_paused: boolean
    candy_machine_id: string | null
    collection_mint: string | null
    devnet_candy_machine_id: string | null
    devnet_collection_mint: string | null
    magic_eden_url: string | null
    tensor_url: string | null
    minted_count: number
    metadata_ready: boolean
    assets_ready: boolean
    marketplace_ready: boolean
  }>
): Promise<OwlCenterLaunchPublic | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_launches')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('slug', slug)
    .select('*')
    .single()
  if (error || !data) {
    console.error('updateOwlCenterLaunchAdmin', error)
    return null
  }
  return mapRow(data as Record<string, unknown>)
}

export async function updateOwlCenterLaunchByIdAdmin(
  id: string,
  patch: Partial<{
    active_phase: OwlCenterPhase
    status: OwlCenterStatus
    is_paused: boolean
    candy_machine_id: string | null
    collection_mint: string | null
    devnet_candy_machine_id: string | null
    devnet_collection_mint: string | null
    magic_eden_url: string | null
    tensor_url: string | null
    minted_count: number
    metadata_ready: boolean
    assets_ready: boolean
    marketplace_ready: boolean
  }>
): Promise<OwlCenterLaunchPublic | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_launches')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single()
  if (error || !data) {
    console.error('updateOwlCenterLaunchByIdAdmin', error)
    return null
  }
  return mapRow(data as Record<string, unknown>)
}
