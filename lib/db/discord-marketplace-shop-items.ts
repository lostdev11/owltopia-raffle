import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type ShopDepositKind = 'none' | 'nft' | 'owl_spl'
export type ShopPriceCurrency = 'POINTS' | 'SOL' | 'OWL'
export type ShopItemStatus =
  | 'pending_deposit'
  | 'available'
  | 'sold'
  | 'removed'
  | 'fulfillment_failed'

export type DiscordMarketplaceShopItem = {
  id: string
  discord_guild_id: string
  slug: string
  display_name: string
  description: string | null
  deposit_kind: ShopDepositKind
  asset_mint: string | null
  units_per_sale: number
  price_amount: number
  price_currency: ShopPriceCurrency
  treasury_funded: boolean
  status: ShopItemStatus
  deposit_tx_signature: string | null
  listed_by_wallet: string | null
  created_at: string
  updated_at: string
}

function mapRow(row: Record<string, unknown>): DiscordMarketplaceShopItem {
  return {
    id: String(row.id),
    discord_guild_id: String(row.discord_guild_id),
    slug: String(row.slug),
    display_name: String(row.display_name),
    description: row.description != null ? String(row.description) : null,
    deposit_kind: row.deposit_kind as ShopDepositKind,
    asset_mint: row.asset_mint != null ? String(row.asset_mint) : null,
    units_per_sale: Number(row.units_per_sale),
    price_amount: Number(row.price_amount),
    price_currency: row.price_currency as ShopPriceCurrency,
    treasury_funded: Boolean(row.treasury_funded),
    status: row.status as ShopItemStatus,
    deposit_tx_signature: row.deposit_tx_signature != null ? String(row.deposit_tx_signature) : null,
    listed_by_wallet: row.listed_by_wallet != null ? String(row.listed_by_wallet) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export function slugifyShopItemSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export function resolveShopItemInitialStatus(params: {
  deposit_kind: ShopDepositKind
  treasury_funded: boolean
}): ShopItemStatus {
  if (params.deposit_kind === 'none' || params.treasury_funded) return 'available'
  return 'pending_deposit'
}

export async function createShopItem(params: {
  discord_guild_id: string
  slug: string
  display_name: string
  description?: string | null
  deposit_kind: ShopDepositKind
  asset_mint?: string | null
  units_per_sale: number
  price_amount: number
  price_currency: ShopPriceCurrency
  treasury_funded?: boolean
  listed_by_wallet?: string | null
}): Promise<DiscordMarketplaceShopItem | null> {
  const treasuryFunded = params.treasury_funded ?? false
  const status = resolveShopItemInitialStatus({
    deposit_kind: params.deposit_kind,
    treasury_funded: treasuryFunded,
  })
  const now = new Date().toISOString()

  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_shop_items')
    .insert({
      discord_guild_id: params.discord_guild_id.trim(),
      slug: params.slug.trim().toLowerCase(),
      display_name: params.display_name.trim(),
      description: params.description?.trim() || null,
      deposit_kind: params.deposit_kind,
      asset_mint: params.asset_mint?.trim() || null,
      units_per_sale: params.units_per_sale,
      price_amount: params.price_amount,
      price_currency: params.price_currency,
      treasury_funded: treasuryFunded,
      status,
      listed_by_wallet: params.listed_by_wallet?.trim() || null,
      updated_at: now,
    })
    .select()
    .single()

  if (error) {
    console.error('createShopItem:', error.message)
    return null
  }
  return mapRow(data as Record<string, unknown>)
}

export async function listShopItems(
  guildId: string,
  opts?: { status?: ShopItemStatus | ShopItemStatus[] }
): Promise<DiscordMarketplaceShopItem[]> {
  let q = getSupabaseAdmin()
    .from('discord_marketplace_shop_items')
    .select('*')
    .eq('discord_guild_id', guildId.trim())
    .order('created_at', { ascending: false })

  if (opts?.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status]
    q = q.in('status', statuses)
  }

  const { data, error } = await q
  if (error) {
    console.error('listShopItems:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function getShopItemBySlug(
  guildId: string,
  slug: string
): Promise<DiscordMarketplaceShopItem | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_shop_items')
    .select('*')
    .eq('discord_guild_id', guildId.trim())
    .eq('slug', slug.trim().toLowerCase())
    .maybeSingle()

  if (error) {
    console.error('getShopItemBySlug:', error.message)
    return null
  }
  return data ? mapRow(data as Record<string, unknown>) : null
}

export async function getShopItemById(id: string): Promise<DiscordMarketplaceShopItem | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_shop_items')
    .select('*')
    .eq('id', id.trim())
    .maybeSingle()

  if (error) {
    console.error('getShopItemById:', error.message)
    return null
  }
  return data ? mapRow(data as Record<string, unknown>) : null
}

export async function markShopItemAvailable(
  id: string,
  depositTxSignature?: string | null
): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('discord_marketplace_shop_items')
    .update({
      status: 'available',
      deposit_tx_signature: depositTxSignature?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id.trim())
    .eq('status', 'pending_deposit')

  if (error) {
    console.error('markShopItemAvailable:', error.message)
    return false
  }
  return true
}

export async function markShopItemSold(id: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('discord_marketplace_shop_items')
    .update({
      status: 'sold',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id.trim())
    .eq('status', 'available')

  if (error) {
    console.error('markShopItemSold:', error.message)
    return false
  }
  return true
}

export async function removeShopItem(id: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('discord_marketplace_shop_items')
    .update({
      status: 'removed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id.trim())
    .in('status', ['pending_deposit', 'available'])

  if (error) {
    console.error('removeShopItem:', error.message)
    return false
  }
  return true
}

export async function markShopItemFulfillmentFailed(id: string, errorMessage: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('discord_marketplace_shop_items')
    .update({
      status: 'fulfillment_failed',
      updated_at: new Date().toISOString(),
      description: errorMessage.slice(0, 200),
    })
    .eq('id', id.trim())

  if (error) {
    console.error('markShopItemFulfillmentFailed:', error.message)
    return false
  }
  return true
}
