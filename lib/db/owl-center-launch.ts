import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { parseActivePhases, parsePhaseSchedule } from '@/lib/owl-center/phase-schedule'
import { parseWalletSplitsFromDb } from '@/lib/owl-center/wallet-splits'
import type {
  OwlCenterFreezeProgress,
  OwlCenterFreezeStatus,
  OwlCenterLaunchPublic,
  OwlCenterMintMode,
  OwlCenterPhase,
  OwlCenterRevealMode,
  OwlCenterRevealProgress,
  OwlCenterRevealStatus,
  OwlCenterStatus,
} from '@/lib/owl-center/types'

/**
 * Normalize a DB timestamptz value to a clean ISO string.
 *
 * Postgres returns timestamptz as e.g. `2026-06-26 16:00:00+00` (space
 * separator, `+00` offset), which is non-standard for `new Date()` and parses
 * inconsistently across JS engines. `phase_schedule` is already normalized via
 * `parsePhaseSchedule`, so normalize standalone timestamps the same way to keep
 * every wall-clock display (e.g. "Mint opens" vs phase open times) in agreement.
 */
function normalizeTimestamp(raw: unknown): string | null {
  if (raw == null) return null
  const ms = new Date(String(raw)).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function parseRevealMode(raw: unknown): OwlCenterRevealMode | null {
  if (raw === 'reveal_day') return 'reveal_day'
  if (raw === 'standard') return 'standard'
  return null
}

function parseRevealStatus(raw: unknown): OwlCenterRevealStatus {
  const s = String(raw ?? 'disabled')
  if (
    s === 'draft' ||
    s === 'scheduled' ||
    s === 'running' ||
    s === 'completed' ||
    s === 'failed'
  ) {
    return s
  }
  return 'disabled'
}

function parseRevealProgress(raw: unknown): OwlCenterRevealProgress {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  return {
    last_run_at: typeof o.last_run_at === 'string' ? o.last_run_at : undefined,
    refreshed_count: typeof o.refreshed_count === 'number' ? o.refreshed_count : undefined,
    skipped_count: typeof o.skipped_count === 'number' ? o.skipped_count : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
    attempts: typeof o.attempts === 'number' ? o.attempts : undefined,
  }
}

function parseFreezeStatus(raw: unknown): OwlCenterFreezeStatus {
  const s = String(raw ?? 'disabled')
  if (s === 'pending' || s === 'frozen' || s === 'thawing' || s === 'thawed' || s === 'failed') {
    return s
  }
  return 'disabled'
}

function parseFreezeProgress(raw: unknown): OwlCenterFreezeProgress {
  if (!raw || typeof raw !== 'object') return {}
  const o = raw as Record<string, unknown>
  const teamWallets = Array.isArray(o.backstop_team_wallets)
    ? o.backstop_team_wallets.filter((w): w is string => typeof w === 'string' && w.trim().length > 0)
    : undefined
  return {
    last_run_at: typeof o.last_run_at === 'string' ? o.last_run_at : undefined,
    thawed_count: typeof o.thawed_count === 'number' ? o.thawed_count : undefined,
    remaining_count: typeof o.remaining_count === 'number' ? o.remaining_count : undefined,
    error: typeof o.error === 'string' ? o.error : undefined,
    attempts: typeof o.attempts === 'number' ? o.attempts : undefined,
    total: typeof o.total === 'number' ? o.total : undefined,
    offset: typeof o.offset === 'number' ? o.offset : undefined,
    started_at: typeof o.started_at === 'string' ? o.started_at : undefined,
    updated_at: typeof o.updated_at === 'string' ? o.updated_at : undefined,
    unlocked_at: typeof o.unlocked_at === 'string' ? o.unlocked_at : undefined,
    last_signature: typeof o.last_signature === 'string' ? o.last_signature : undefined,
    backstop_mint_enabled: typeof o.backstop_mint_enabled === 'boolean' ? o.backstop_mint_enabled : undefined,
    backstop_team_wallets: teamWallets,
    backstop_enabled_at: typeof o.backstop_enabled_at === 'string' ? o.backstop_enabled_at : undefined,
  }
}

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
    active_phases: parseActivePhases(data.active_phases),
    status: String(data.status) as OwlCenterStatus,
    presale_supply: Number(data.presale_supply ?? 0),
    wl_supply: Number(data.wl_supply ?? 0),
    public_supply: Number(data.public_supply ?? 0),
    airdrop_supply: Number(data.airdrop_supply ?? 0),
    presale_overage_supply: Number(data.presale_overage_supply ?? 13),
    presale_price_usdc: data.presale_price_usdc != null ? Number(data.presale_price_usdc) : null,
    wl_price_usdc: data.wl_price_usdc != null ? Number(data.wl_price_usdc) : null,
    public_price_usdc: data.public_price_usdc != null ? Number(data.public_price_usdc) : null,
    wallet_mint_limit: Number(data.wallet_mint_limit ?? 1),
    magic_eden_url: data.magic_eden_url != null ? String(data.magic_eden_url) : null,
    tensor_url: data.tensor_url != null ? String(data.tensor_url) : null,
    is_featured: Boolean(data.is_featured),
    is_paused: Boolean(data.is_paused),
    launch_deadline_at: normalizeTimestamp(data.launch_deadline_at),
    phase_schedule: parsePhaseSchedule(data.phase_schedule),
    updated_at: String(data.updated_at ?? ''),
    metadata_ready: Boolean(data.metadata_ready),
    assets_ready: Boolean(data.assets_ready),
    marketplace_ready: Boolean(data.marketplace_ready),
    treasury_wallet: data.treasury_wallet != null ? String(data.treasury_wallet) : null,
    royalty_splits: parseWalletSplitsFromDb(data.royalty_splits),
    mint_fund_splits: parseWalletSplitsFromDb(data.mint_fund_splits),
    creator_presale_enabled: Boolean(data.creator_presale_enabled),
    creator_wl_enabled: Boolean(data.creator_wl_enabled),
    creator_mint_price:
      data.creator_mint_price != null && data.creator_mint_price !== ''
        ? Number(data.creator_mint_price)
        : null,
    creator_mint_currency: data.creator_mint_currency != null ? String(data.creator_mint_currency) : null,
    creator_launch_date: normalizeTimestamp(data.creator_launch_date),
    mint_mode: (String(data.mint_mode ?? 'gen2_full') === 'public_simple' ? 'public_simple' : 'gen2_full') as OwlCenterMintMode,
    mint_network:
      data.mint_network === 'devnet' || data.mint_network === 'mainnet'
        ? (data.mint_network as 'devnet' | 'mainnet')
        : null,
    generator_project_id:
      data.generator_project_id != null && String(data.generator_project_id).trim()
        ? String(data.generator_project_id).trim()
        : null,
    seller_fee_basis_points: Number(data.seller_fee_basis_points ?? 500),
    reveal_mode: parseRevealMode(data.reveal_mode),
    reveal_status: parseRevealStatus(data.reveal_status),
    reveal_at: data.reveal_at != null ? String(data.reveal_at) : null,
    reveal_completed_at: data.reveal_completed_at != null ? String(data.reveal_completed_at) : null,
    reveal_payment_tx_signature:
      data.reveal_payment_tx_signature != null ? String(data.reveal_payment_tx_signature) : null,
    placeholder_metadata_uri:
      data.placeholder_metadata_uri != null ? String(data.placeholder_metadata_uri) : null,
    reveal_progress: parseRevealProgress(data.reveal_progress),
    freeze_enabled: Boolean(data.freeze_enabled),
    unfreeze_date: data.unfreeze_date != null ? String(data.unfreeze_date) : null,
    freeze_status: parseFreezeStatus(data.freeze_status),
    freeze_authority: data.freeze_authority != null ? String(data.freeze_authority) : null,
    freeze_thawed_at: data.freeze_thawed_at != null ? String(data.freeze_thawed_at) : null,
    freeze_progress: parseFreezeProgress(data.freeze_progress),
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

/** Admin/service — all launches including draft / pending review. */
export async function listOwlCenterLaunchesAdmin(): Promise<OwlCenterLaunchPublic[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_launches')
    .select('*')
    .order('is_featured', { ascending: false })
    .order('updated_at', { ascending: false })
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapRow)
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

/** Creator dashboard — launches owned by wallet (includes pending review). */
export async function listOwlCenterLaunchesByCreatorWallet(
  creatorWallet: string
): Promise<OwlCenterLaunchPublic[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('owl_center_launches')
    .select('*')
    .eq('creator_wallet', creatorWallet)
    .order('updated_at', { ascending: false })
  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapRow)
}

export async function updateOwlCenterLaunchAdmin(
  slug: string,
  patch: Partial<{
    active_phase: OwlCenterPhase
    active_phases: OwlCenterPhase[]
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
    launch_deadline_at: string | null
    phase_schedule: Record<string, string>
    generator_project_id: string | null
    wl_supply: number
    freeze_status: OwlCenterFreezeStatus
    freeze_thawed_at: string | null
    freeze_progress: OwlCenterFreezeProgress
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
    active_phases: OwlCenterPhase[]
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
    mint_mode: OwlCenterMintMode
    mint_network: 'devnet' | 'mainnet' | null
    name: string
    description: string | null
    image_url: string | null
    public_price_usdc: number | null
    wallet_mint_limit: number
    is_featured: boolean
    launch_deadline_at: string | null
    phase_schedule: Record<string, string>
    total_supply: number
    public_supply: number
    presale_supply: number
    wl_supply: number
    airdrop_supply: number
    presale_overage_supply: number
    wl_price_usdc: number | null
    creator_presale_enabled: boolean
    creator_wl_enabled: boolean
    creator_mint_price: number | null
    creator_mint_currency: 'SOL' | 'USDC' | null
    creator_launch_date: string | null
    generator_project_id: string | null
    seller_fee_basis_points: number
    treasury_wallet: string | null
    royalty_splits: import('@/lib/owl-center/wallet-splits').WalletSplit[] | null
    mint_fund_splits: import('@/lib/owl-center/wallet-splits').WalletSplit[] | null
    reveal_mode: OwlCenterRevealMode | null
    reveal_status: OwlCenterRevealStatus
    reveal_at: string | null
    reveal_completed_at: string | null
    reveal_payment_tx_signature: string | null
    placeholder_metadata_uri: string | null
    reveal_progress: OwlCenterRevealProgress
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

export type InsertOwlCenterLaunchInput = {
  slug: string
  name: string
  symbol: string
  description?: string | null
  image_url?: string | null
  creator_wallet?: string | null
  treasury_wallet?: string | null
  total_supply: number
  public_supply?: number
  wallet_mint_limit?: number
  public_price_usdc?: number | null
  mint_mode?: OwlCenterMintMode
  mint_network?: 'devnet' | 'mainnet' | null
  active_phase?: OwlCenterPhase
  status?: OwlCenterStatus
  candy_machine_id?: string | null
  collection_mint?: string | null
  devnet_candy_machine_id?: string | null
  devnet_collection_mint?: string | null
  is_featured?: boolean
}

/** Admin create — inserts launch row for public_simple demo/partner collections. */
export async function insertOwlCenterLaunchAdmin(input: InsertOwlCenterLaunchInput): Promise<OwlCenterLaunchPublic | null> {
  const db = getSupabaseAdmin()
  const publicSupply = input.public_supply ?? input.total_supply
  const { data, error } = await db
    .from('owl_center_launches')
    .insert({
      slug: input.slug.trim().toLowerCase(),
      name: input.name.trim(),
      symbol: input.symbol.trim(),
      description: input.description ?? null,
      image_url: input.image_url ?? null,
      creator_wallet: input.creator_wallet ?? null,
      treasury_wallet: input.treasury_wallet ?? null,
      total_supply: input.total_supply,
      public_supply: publicSupply,
      presale_supply: 0,
      wl_supply: 0,
      airdrop_supply: 0,
      wallet_mint_limit: input.wallet_mint_limit ?? 5,
      public_price_usdc: input.public_price_usdc ?? null,
      mint_mode: input.mint_mode ?? 'public_simple',
      mint_network: input.mint_network ?? null,
      active_phase: input.active_phase ?? 'PUBLIC',
      status: input.status ?? 'PUBLIC',
      candy_machine_id: input.candy_machine_id ?? null,
      collection_mint: input.collection_mint ?? null,
      devnet_candy_machine_id: input.devnet_candy_machine_id ?? null,
      devnet_collection_mint: input.devnet_collection_mint ?? null,
      is_featured: input.is_featured ?? false,
      is_paused: false,
    })
    .select('*')
    .single()
  if (error || !data) {
    console.error('insertOwlCenterLaunchAdmin', error)
    return null
  }
  return mapRow(data as Record<string, unknown>)
}

/** Hard delete — cascades mint events, asset packages, marketplace rows, upload jobs. */
export async function deleteOwlCenterLaunchByIdAdmin(id: string): Promise<boolean> {
  const db = getSupabaseAdmin()
  const { error, count } = await db.from('owl_center_launches').delete({ count: 'exact' }).eq('id', id)
  if (error) {
    console.error('deleteOwlCenterLaunchByIdAdmin', error)
    return false
  }
  return (count ?? 0) > 0
}

/** Reveal Day cron — scheduled launches whose reveal_at has passed. */
export async function listOwlCenterLaunchesDueForReveal(
  nowMs: number = Date.now()
): Promise<OwlCenterLaunchPublic[]> {
  const db = getSupabaseAdmin()
  const nowIso = new Date(nowMs).toISOString()
  const { data, error } = await db
    .from('owl_center_launches')
    .select('*')
    .eq('reveal_mode', 'reveal_day')
    .eq('reveal_status', 'scheduled')
    .not('reveal_at', 'is', null)
    .lte('reveal_at', nowIso)

  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(mapRow)
}
