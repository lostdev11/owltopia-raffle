import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type PartnerCommunityCreatorRow = {
  creator_wallet: string
  display_label: string | null
  sort_order: number
  is_active: boolean
  /** When set, new raffles from this wallet use that partner tenant for Discord raffle webhooks. */
  discord_partner_tenant_id: string | null
  created_at: string
  updated_at: string
}

/**
 * All rows (active and inactive). Service role only — used by Owl Vision admin.
 */
export async function listPartnerCommunityCreatorsAdmin(): Promise<PartnerCommunityCreatorRow[]> {
  const sb = getSupabaseAdmin()
  const { data, error } = await sb
    .from('partner_community_creators')
    .select('creator_wallet, display_label, sort_order, is_active, discord_partner_tenant_id, created_at, updated_at')
    .order('sort_order', { ascending: true })
    .order('creator_wallet', { ascending: true })

  if (error) throw new Error(error.message)
  return (data ?? []) as PartnerCommunityCreatorRow[]
}

export async function insertPartnerCommunityCreator(input: {
  creator_wallet: string
  display_label?: string | null
  sort_order?: number
  is_active?: boolean
  discord_partner_tenant_id?: string | null
}): Promise<PartnerCommunityCreatorRow> {
  const sb = getSupabaseAdmin()
  const row: Record<string, unknown> = {
    creator_wallet: input.creator_wallet,
    display_label: input.display_label?.trim() || null,
    sort_order: input.sort_order ?? 0,
    is_active: input.is_active !== false,
  }
  if (input.discord_partner_tenant_id !== undefined) {
    const t = input.discord_partner_tenant_id?.trim()
    row.discord_partner_tenant_id = t || null
  }
  const { data, error } = await sb.from('partner_community_creators').insert(row).select().single()

  if (error) throw new Error(error.message)
  return data as PartnerCommunityCreatorRow
}

export async function updatePartnerCommunityCreator(
  creator_wallet: string,
  patch: {
    display_label?: string | null
    sort_order?: number
    is_active?: boolean
    discord_partner_tenant_id?: string | null
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
  if (patch.is_active !== undefined) updates.is_active = patch.is_active
  if (patch.discord_partner_tenant_id !== undefined) {
    const t = patch.discord_partner_tenant_id?.trim()
    updates.discord_partner_tenant_id = t || null
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

export async function deletePartnerCommunityCreator(creator_wallet: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('partner_community_creators').delete().eq('creator_wallet', creator_wallet)
  if (error) throw new Error(error.message)
}
