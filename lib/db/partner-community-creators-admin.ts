import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type PartnerCommunityCreatorRow = {
  creator_wallet: string
  display_label: string | null
  sort_order: number
  is_active: boolean
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
    .select('creator_wallet, display_label, sort_order, is_active, created_at, updated_at')
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
}): Promise<PartnerCommunityCreatorRow> {
  const sb = getSupabaseAdmin()
  const row = {
    creator_wallet: input.creator_wallet,
    display_label: input.display_label?.trim() || null,
    sort_order: input.sort_order ?? 0,
    is_active: input.is_active !== false,
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

  const { data, error } = await sb
    .from('partner_community_creators')
    .update(updates)
    .eq('creator_wallet', creator_wallet)
    .select()
    .single()

  if (error) throw new Error(error.message)
  return data as PartnerCommunityCreatorRow
}

export async function deletePartnerCommunityCreator(creator_wallet: string): Promise<void> {
  const sb = getSupabaseAdmin()
  const { error } = await sb.from('partner_community_creators').delete().eq('creator_wallet', creator_wallet)
  if (error) throw new Error(error.message)
}
