import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type PartnerCommunityCreatorRow = {
  creator_wallet: string
  display_label: string | null
  partner_tier: '$0_partner' | 'partner_pro' | 'white_label' | string
  sort_order: number
  is_active: boolean
  /** When set, new raffles from this wallet use that partner tenant for Discord raffle webhooks. */
  discord_partner_tenant_id: string | null
  /**
   * Whole USDC charged per `/owltopia-partner subscribe` cycle when `discord_partner_tenant_id` matches that tenant.
   * Null means catalog standard (`DISCORD_PARTNER_USDC_PRICE`).
   */
  partner_pro_monthly_quote_usdc: number | null
  created_at: string
  updated_at: string
}

export type PartnerRaffleVisibilityEntitlement = {
  partnerTier: string | null
  discordPartnerTenantId: string | null
  canSetPartnerOnly: boolean
}

function isPartnerOnlyVisibilityTier(partnerTier: string | null | undefined): boolean {
  return partnerTier === 'partner_pro' || partnerTier === 'white_label'
}

/**
 * All rows (active and inactive). Service role only — used by Owl Vision admin.
 */
export async function listPartnerCommunityCreatorsAdmin(): Promise<PartnerCommunityCreatorRow[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_community_creators')
    .select(
      'creator_wallet, display_label, partner_tier, sort_order, is_active, discord_partner_tenant_id, partner_pro_monthly_quote_usdc, created_at, updated_at'
    )
    .order('sort_order', { ascending: true })
    .order('creator_wallet', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as PartnerCommunityCreatorRow[]
}

export async function insertPartnerCommunityCreator(input: {
  creator_wallet: string
  display_label?: string | null
  partner_tier?: '$0_partner' | 'partner_pro' | 'white_label'
  sort_order?: number
  is_active?: boolean
  discord_partner_tenant_id?: string | null
  partner_pro_monthly_quote_usdc?: number | null
}): Promise<PartnerCommunityCreatorRow> {
  const sb = getSupabaseAdmin()
  const row: Record<string, unknown> = {
    creator_wallet: input.creator_wallet,
    display_label: input.display_label?.trim() || null,
    partner_tier: input.partner_tier ?? '$0_partner',
    sort_order: input.sort_order ?? 0,
    is_active: input.is_active !== false,
  }
  if (input.discord_partner_tenant_id !== undefined) {
    const t = input.discord_partner_tenant_id?.trim()
    row.discord_partner_tenant_id = t || null
  }
  if (input.partner_pro_monthly_quote_usdc !== undefined) {
    row.partner_pro_monthly_quote_usdc = input.partner_pro_monthly_quote_usdc
  }
  const { data, error } = await sb.from('partner_community_creators').insert(row).select().single()

  if (error) throw new Error(error.message)
  return data as PartnerCommunityCreatorRow
}

export async function updatePartnerCommunityCreator(
  creator_wallet: string,
  patch: {
    display_label?: string | null
    partner_tier?: '$0_partner' | 'partner_pro' | 'white_label'
    sort_order?: number
    is_active?: boolean
    discord_partner_tenant_id?: string | null
    partner_pro_monthly_quote_usdc?: number | null
  }
): Promise<PartnerCommunityCreatorRow> {
  const sb = getSupabaseAdmin()
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.display_label !== undefined) {
    updates.display_label =
      patch.display_label === null || String(patch.display_label).trim() === ''
        ? null
        : String(patch.display_label).trim()
  }
  if (patch.sort_order !== undefined) updates.sort_order = patch.sort_order
  if (patch.partner_tier !== undefined) updates.partner_tier = patch.partner_tier
  if (patch.is_active !== undefined) updates.is_active = patch.is_active
  if (patch.discord_partner_tenant_id !== undefined) {
    const t = patch.discord_partner_tenant_id?.trim()
    updates.discord_partner_tenant_id = t || null
  }
  if (patch.partner_pro_monthly_quote_usdc !== undefined) {
    updates.partner_pro_monthly_quote_usdc = patch.partner_pro_monthly_quote_usdc
  }

  const { data, error } = await sb
    .from('partner_community_creators')
    .update(updates)
    .eq('creator_wallet', creator_wallet)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as PartnerCommunityCreatorRow
}

/**
 * If this wallet is an active partner program creator with a linked Discord partner tenant,
 * return that tenant id (for stamping `raffles.discord_partner_tenant_id` at create time).
 */
export async function getDiscordPartnerTenantIdForCreatorWallet(
  creatorWallet: string
): Promise<string | null> {
  const w = typeof creatorWallet === 'string' ? creatorWallet.trim() : ''
  if (!w) return null
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_community_creators')
    .select('discord_partner_tenant_id')
    .eq('creator_wallet', w)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    const msg = (error.message ?? '').toLowerCase()
    if (msg.includes('discord_partner_tenant_id') || msg.includes('column') || msg.includes('42703')) {
      return null
    }
    console.error('getDiscordPartnerTenantIdForCreatorWallet:', error.message)
    return null
  }
  const id = (data as { discord_partner_tenant_id?: string | null } | null)?.discord_partner_tenant_id
  if (id == null || !String(id).trim()) return null
  return String(id).trim()
}

/**
 * Partner Pro+ wallets can create direct-link / Discord-only raffles.
 * Discord tenant linkage is returned separately so creation can stamp webhooks when configured.
 */
export async function getPartnerRaffleVisibilityEntitlementForCreatorWallet(
  creatorWallet: string
): Promise<PartnerRaffleVisibilityEntitlement> {
  const fallback: PartnerRaffleVisibilityEntitlement = {
    partnerTier: null,
    discordPartnerTenantId: null,
    canSetPartnerOnly: false,
  }
  const w = typeof creatorWallet === 'string' ? creatorWallet.trim() : ''
  if (!w) return fallback

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_community_creators')
    .select('partner_tier, discord_partner_tenant_id')
    .eq('creator_wallet', w)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    const msg = (error.message ?? '').toLowerCase()
    if (msg.includes('partner_tier') || msg.includes('discord_partner_tenant_id') || msg.includes('column') || msg.includes('42703')) {
      return fallback
    }
    console.error('getPartnerRaffleVisibilityEntitlementForCreatorWallet:', error.message)
    return fallback
  }

  const row = data as { partner_tier?: string | null; discord_partner_tenant_id?: string | null } | null
  const partnerTier = row?.partner_tier?.trim() || null
  const discordPartnerTenantId = row?.discord_partner_tenant_id?.trim() || null
  return {
    partnerTier,
    discordPartnerTenantId,
    canSetPartnerOnly: isPartnerOnlyVisibilityTier(partnerTier),
  }
}

/**
 * When a Discord guild already has a partner tenant row, use the lowest active linked USDC quote, or null for catalog pricing.
 */
export async function getPartnerProMonthlyQuoteUsdcForDiscordTenant(
  discordTenantId: string
): Promise<number | null> {
  const id = typeof discordTenantId === 'string' ? discordTenantId.trim() : ''
  if (!id) return null

  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_community_creators')
    .select('partner_pro_monthly_quote_usdc')
    .eq('discord_partner_tenant_id', id)
    .eq('is_active', true)

  if (error) {
    const msg = (error.message ?? '').toLowerCase()
    if (
      msg.includes('partner_pro_monthly_quote_usdc') ||
      msg.includes('column') ||
      msg.includes('42703')
    ) {
      return null
    }
    console.error('getPartnerProMonthlyQuoteUsdcForDiscordTenant:', error.message)
    throw new Error(error.message)
  }

  const quotes = (data ?? [])
    .map((r) => (r as { partner_pro_monthly_quote_usdc?: unknown }).partner_pro_monthly_quote_usdc)
    .filter((q): q is number => typeof q === 'number' && Number.isFinite(q) && q > 0)

  if (quotes.length === 0) return null
  return Math.min(...quotes)
}

export async function deletePartnerCommunityCreator(creator_wallet: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('partner_community_creators').delete().eq('creator_wallet', creator_wallet)
  if (error) throw new Error(error.message)
}
