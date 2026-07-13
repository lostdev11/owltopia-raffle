import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type DiscordMarketplaceProduct = {
  id: string
  discord_guild_id: string
  slug: string
  name: string
  description: string | null
  points_cost: number
  owl_delivery_amount: number
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export type DiscordMarketplaceOrder = {
  id: string
  discord_user_id: string
  discord_guild_id: string
  product_id: string
  product_name: string
  points_spent: number
  owl_delivery_amount: number
  recipient_wallet: string | null
  status: 'pending_fulfillment' | 'fulfilled' | 'fulfillment_failed' | 'refunded'
  fulfillment_tx_signature: string | null
  fulfillment_error: string | null
  created_at: string
  fulfilled_at: string | null
}

function mapProduct(row: Record<string, unknown>): DiscordMarketplaceProduct {
  return {
    id: String(row.id),
    discord_guild_id: String(row.discord_guild_id),
    slug: String(row.slug),
    name: String(row.name),
    description: row.description != null ? String(row.description) : null,
    points_cost: Number(row.points_cost),
    owl_delivery_amount: Number(row.owl_delivery_amount),
    active: Boolean(row.active),
    sort_order: Number(row.sort_order ?? 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function mapOrder(row: Record<string, unknown>): DiscordMarketplaceOrder {
  return {
    id: String(row.id),
    discord_user_id: String(row.discord_user_id),
    discord_guild_id: String(row.discord_guild_id),
    product_id: String(row.product_id),
    product_name: String(row.product_name),
    points_spent: Number(row.points_spent),
    owl_delivery_amount: Number(row.owl_delivery_amount),
    recipient_wallet: row.recipient_wallet != null ? String(row.recipient_wallet) : null,
    status: row.status as DiscordMarketplaceOrder['status'],
    fulfillment_tx_signature:
      row.fulfillment_tx_signature != null ? String(row.fulfillment_tx_signature) : null,
    fulfillment_error: row.fulfillment_error != null ? String(row.fulfillment_error) : null,
    created_at: String(row.created_at),
    fulfilled_at: row.fulfilled_at != null ? String(row.fulfilled_at) : null,
  }
}

export function slugifyMarketplaceProductSlug(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

export async function listActiveMarketplaceProducts(
  guildId: string
): Promise<DiscordMarketplaceProduct[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_products')
    .select('*')
    .eq('discord_guild_id', guildId.trim())
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('listActiveMarketplaceProducts:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapProduct(r as Record<string, unknown>))
}

export async function listAllMarketplaceProducts(
  guildId: string
): Promise<DiscordMarketplaceProduct[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_products')
    .select('*')
    .eq('discord_guild_id', guildId.trim())
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('listAllMarketplaceProducts:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapProduct(r as Record<string, unknown>))
}

export async function getMarketplaceProductBySlug(
  guildId: string,
  slug: string
): Promise<DiscordMarketplaceProduct | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_products')
    .select('*')
    .eq('discord_guild_id', guildId.trim())
    .eq('slug', slug.trim().toLowerCase())
    .maybeSingle()

  if (error) {
    console.error('getMarketplaceProductBySlug:', error.message)
    return null
  }
  return data ? mapProduct(data as Record<string, unknown>) : null
}

export async function getMarketplaceProductById(
  productId: string
): Promise<DiscordMarketplaceProduct | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_products')
    .select('*')
    .eq('id', productId.trim())
    .maybeSingle()

  if (error) {
    console.error('getMarketplaceProductById:', error.message)
    return null
  }
  return data ? mapProduct(data as Record<string, unknown>) : null
}

export async function upsertMarketplaceProduct(params: {
  discord_guild_id: string
  slug: string
  name: string
  description?: string | null
  points_cost: number
  owl_delivery_amount: number
  active?: boolean
  sort_order?: number
}): Promise<DiscordMarketplaceProduct | null> {
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_products')
    .upsert(
      {
        discord_guild_id: params.discord_guild_id.trim(),
        slug: params.slug.trim().toLowerCase(),
        name: params.name.trim(),
        description: params.description?.trim() || null,
        points_cost: params.points_cost,
        owl_delivery_amount: params.owl_delivery_amount,
        active: params.active ?? true,
        sort_order: params.sort_order ?? 0,
        updated_at: now,
      },
      { onConflict: 'discord_guild_id,slug' }
    )
    .select()
    .single()

  if (error) {
    console.error('upsertMarketplaceProduct:', error.message)
    return null
  }
  return mapProduct(data as Record<string, unknown>)
}

export async function getMarketplacePointsBalance(
  discordUserId: string,
  guildId: string
): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_balances')
    .select('points_balance')
    .eq('discord_user_id', discordUserId.trim())
    .eq('discord_guild_id', guildId.trim())
    .maybeSingle()

  if (error) {
    console.error('getMarketplacePointsBalance:', error.message)
    return 0
  }
  return data?.points_balance != null ? Number(data.points_balance) : 0
}

export async function grantMarketplacePoints(params: {
  discord_user_id: string
  discord_guild_id: string
  delta: number
}): Promise<number | null> {
  const uid = params.discord_user_id.trim()
  const gid = params.discord_guild_id.trim()
  const delta = Math.trunc(params.delta)
  if (!uid || !gid || !Number.isFinite(delta) || delta === 0) return null

  const admin = getSupabaseAdmin()
  const { data: existing } = await admin
    .from('discord_marketplace_balances')
    .select('points_balance')
    .eq('discord_user_id', uid)
    .eq('discord_guild_id', gid)
    .maybeSingle()

  const current = existing?.points_balance != null ? Number(existing.points_balance) : 0
  const next = current + delta
  if (next < 0) return null

  const { data, error } = await admin
    .from('discord_marketplace_balances')
    .upsert(
      {
        discord_user_id: uid,
        discord_guild_id: gid,
        points_balance: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'discord_user_id,discord_guild_id' }
    )
    .select('points_balance')
    .single()

  if (error) {
    console.error('grantMarketplacePoints:', error.message)
    return null
  }
  return data?.points_balance != null ? Number(data.points_balance) : null
}

export type CreateMarketplaceOrderResult =
  | {
      ok: true
      order_id: string
      product_name: string
      points_spent: number
      owl_delivery_amount: number
    }
  | { ok: false; code: 'product_not_found' | 'insufficient_points' | 'db_error'; message: string }

export async function createMarketplaceOrder(params: {
  discord_user_id: string
  discord_guild_id: string
  product_id: string
  recipient_wallet: string
}): Promise<CreateMarketplaceOrderResult> {
  const { data, error } = await getSupabaseAdmin().rpc('discord_marketplace_create_order', {
    p_discord_user_id: params.discord_user_id.trim(),
    p_discord_guild_id: params.discord_guild_id.trim(),
    p_product_id: params.product_id.trim(),
    p_recipient_wallet: params.recipient_wallet.trim(),
  })

  if (error) {
    const msg = error.message ?? 'db_error'
    if (msg.includes('product_not_found')) {
      return { ok: false, code: 'product_not_found', message: 'Product not found or inactive.' }
    }
    if (msg.includes('insufficient_points')) {
      return { ok: false, code: 'insufficient_points', message: 'Not enough points for this purchase.' }
    }
    console.error('createMarketplaceOrder:', msg)
    return { ok: false, code: 'db_error', message: msg }
  }

  const row = data as Record<string, unknown>
  return {
    ok: true,
    order_id: String(row.order_id),
    product_name: String(row.product_name),
    points_spent: Number(row.points_spent),
    owl_delivery_amount: Number(row.owl_delivery_amount),
  }
}

export async function markMarketplaceOrderFulfilled(
  orderId: string,
  txSignature: string
): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('discord_marketplace_orders')
    .update({
      status: 'fulfilled',
      fulfillment_tx_signature: txSignature.trim(),
      fulfilled_at: new Date().toISOString(),
      fulfillment_error: null,
    })
    .eq('id', orderId.trim())
    .eq('status', 'pending_fulfillment')

  if (error) {
    console.error('markMarketplaceOrderFulfilled:', error.message)
    return false
  }
  return true
}

export async function markMarketplaceOrderFailed(
  orderId: string,
  errorMessage: string
): Promise<boolean> {
  const { error } = await getSupabaseAdmin()
    .from('discord_marketplace_orders')
    .update({
      status: 'fulfillment_failed',
      fulfillment_error: errorMessage.slice(0, 500),
    })
    .eq('id', orderId.trim())
    .in('status', ['pending_fulfillment'])

  if (error) {
    console.error('markMarketplaceOrderFailed:', error.message)
    return false
  }
  return true
}

export async function refundMarketplaceOrder(orderId: string): Promise<boolean> {
  const { error } = await getSupabaseAdmin().rpc('discord_marketplace_refund_order', {
    p_order_id: orderId.trim(),
  })
  if (error) {
    console.error('refundMarketplaceOrder:', error.message)
    return false
  }
  return true
}

export async function listRecentMarketplaceOrders(
  discordUserId: string,
  guildId: string,
  limit = 10
): Promise<DiscordMarketplaceOrder[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_marketplace_orders')
    .select('*')
    .eq('discord_user_id', discordUserId.trim())
    .eq('discord_guild_id', guildId.trim())
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    console.error('listRecentMarketplaceOrders:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapOrder(r as Record<string, unknown>))
}
