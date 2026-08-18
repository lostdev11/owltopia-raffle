import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { normalizePhaseKey } from '@/lib/owl-center/partner-allowlist-phases'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import type { DiscordWlCampaignStatus } from '@/lib/discord-wl/campaign-rules'

export type DiscordWlCampaignRow = {
  id: number
  discord_guild_id: string
  partner_tenant_id: string
  channel_id: string
  message_id: string | null
  name: string
  phase_key: string
  launch_id: string | null
  status: DiscordWlCampaignStatus
  max_entries: number | null
  spots_per_wallet: number
  required_role_id: string | null
  required_role_name: string | null
  created_by_wallet: string
  created_by_discord_user_id: string
  opened_at: string | null
  closed_at: string | null
  last_pushed_at: string | null
  created_at: string
  updated_at: string
}

export type DiscordWlSubmissionRow = {
  id: number
  campaign_id: number
  discord_user_id: string
  discord_username: string | null
  wallet: string
  source: 'linked_wallet' | 'modal'
  created_at: string
}

function asStatus(raw: unknown): DiscordWlCampaignStatus {
  if (raw === 'open' || raw === 'closed' || raw === 'draft') return raw
  return 'draft'
}

function mapCampaign(row: Record<string, unknown>): DiscordWlCampaignRow {
  const maxRaw = row.max_entries
  const max = maxRaw == null ? null : Math.floor(Number(maxRaw))
  return {
    id: Number(row.id),
    discord_guild_id: String(row.discord_guild_id),
    partner_tenant_id: String(row.partner_tenant_id),
    channel_id: String(row.channel_id),
    message_id: row.message_id != null ? String(row.message_id) : null,
    name: String(row.name ?? ''),
    phase_key: normalizePhaseKey(String(row.phase_key ?? 'wl')) || 'wl',
    launch_id: row.launch_id != null ? String(row.launch_id) : null,
    status: asStatus(row.status),
    max_entries: max != null && Number.isFinite(max) && max > 0 ? max : null,
    spots_per_wallet: Math.max(1, Math.floor(Number(row.spots_per_wallet ?? 1) || 1)),
    required_role_id: row.required_role_id != null ? String(row.required_role_id) : null,
    required_role_name: row.required_role_name != null ? String(row.required_role_name) : null,
    created_by_wallet: String(row.created_by_wallet ?? ''),
    created_by_discord_user_id: String(row.created_by_discord_user_id ?? ''),
    opened_at: row.opened_at != null ? String(row.opened_at) : null,
    closed_at: row.closed_at != null ? String(row.closed_at) : null,
    last_pushed_at: row.last_pushed_at != null ? String(row.last_pushed_at) : null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
  }
}

function mapSubmission(row: Record<string, unknown>): DiscordWlSubmissionRow {
  return {
    id: Number(row.id),
    campaign_id: Number(row.campaign_id),
    discord_user_id: String(row.discord_user_id),
    discord_username: row.discord_username != null ? String(row.discord_username) : null,
    wallet: String(row.wallet),
    source: row.source === 'linked_wallet' ? 'linked_wallet' : 'modal',
    created_at: String(row.created_at ?? ''),
  }
}

export async function createDiscordWlCampaign(input: {
  discordGuildId: string
  partnerTenantId: string
  channelId: string
  name: string
  phaseKey?: string
  launchId?: string | null
  maxEntries?: number | null
  spotsPerWallet?: number
  requiredRoleId?: string | null
  requiredRoleName?: string | null
  createdByWallet: string
  createdByDiscordUserId: string
}): Promise<DiscordWlCampaignRow> {
  const db = getSupabaseAdmin()
  const name = input.name.trim().slice(0, 80)
  if (!name) throw new Error('Name is required')
  const { data, error } = await db
    .from('discord_wl_campaigns')
    .insert({
      discord_guild_id: input.discordGuildId.trim(),
      partner_tenant_id: input.partnerTenantId.trim(),
      channel_id: input.channelId.trim(),
      name,
      phase_key: normalizePhaseKey(input.phaseKey ?? 'wl') || 'wl',
      launch_id: input.launchId?.trim() || null,
      status: 'draft',
      max_entries: input.maxEntries != null && input.maxEntries > 0 ? Math.floor(input.maxEntries) : null,
      spots_per_wallet: Math.max(1, Math.floor(input.spotsPerWallet ?? 1) || 1),
      required_role_id: input.requiredRoleId?.trim() || null,
      required_role_name: input.requiredRoleName?.trim().slice(0, 100) || null,
      created_by_wallet: input.createdByWallet.trim(),
      created_by_discord_user_id: input.createdByDiscordUserId.trim(),
    })
    .select('*')
    .single()
  if (error || !data) {
    console.error('createDiscordWlCampaign:', error?.message)
    throw new Error(error?.message || 'Could not create whitelist spot')
  }
  return mapCampaign(data as Record<string, unknown>)
}

export async function getDiscordWlCampaignById(id: number): Promise<DiscordWlCampaignRow | null> {
  if (!Number.isFinite(id) || id < 1) return null
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('discord_wl_campaigns').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return mapCampaign(data as Record<string, unknown>)
}

export async function listDiscordWlCampaignsByGuild(guildId: string): Promise<DiscordWlCampaignRow[]> {
  const g = guildId.trim()
  if (!g) return []
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('discord_wl_campaigns')
    .select('*')
    .eq('discord_guild_id', g)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) {
    console.error('listDiscordWlCampaignsByGuild:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapCampaign(r as Record<string, unknown>))
}

export async function listDiscordWlCampaignsForPartner(input: {
  wallet: string
  tenantId: string | null
}): Promise<DiscordWlCampaignRow[]> {
  const db = getSupabaseAdmin()
  const wallet = input.wallet.trim()
  const tenant = input.tenantId?.trim() || ''
  let q = db.from('discord_wl_campaigns').select('*').order('updated_at', { ascending: false }).limit(100)
  if (tenant && wallet) {
    q = q.or(`created_by_wallet.eq.${wallet},partner_tenant_id.eq.${tenant}`)
  } else if (tenant) {
    q = q.eq('partner_tenant_id', tenant)
  } else if (wallet) {
    q = q.eq('created_by_wallet', wallet)
  } else {
    return []
  }
  const { data, error } = await q
  if (error) {
    console.error('listDiscordWlCampaignsForPartner:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapCampaign(r as Record<string, unknown>))
}

export async function resolveDiscordWlCampaignInGuild(input: {
  guildId: string
  channelId?: string | null
  spot?: string | null
}): Promise<DiscordWlCampaignRow | null> {
  const list = await listDiscordWlCampaignsByGuild(input.guildId)
  if (list.length === 0) return null
  const spot = input.spot?.trim()
  if (spot) {
    const asId = Number(spot)
    if (Number.isInteger(asId) && asId > 0) {
      return list.find((c) => c.id === asId) ?? null
    }
    const lower = spot.toLowerCase()
    return list.find((c) => c.name.toLowerCase() === lower) ?? list.find((c) => c.name.toLowerCase().includes(lower)) ?? null
  }
  const channelId = input.channelId?.trim()
  if (channelId) {
    const inChannel = list.find((c) => c.channel_id === channelId)
    if (inChannel) return inChannel
  }
  return list[0] ?? null
}

export async function updateDiscordWlCampaign(
  id: number,
  patch: Partial<{
    channel_id: string
    message_id: string | null
    status: DiscordWlCampaignStatus
    opened_at: string | null
    closed_at: string | null
    last_pushed_at: string | null
    launch_id: string | null
  }>
): Promise<DiscordWlCampaignRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('discord_wl_campaigns')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) {
    console.error('updateDiscordWlCampaign:', error.message)
    return null
  }
  if (!data) return null
  return mapCampaign(data as Record<string, unknown>)
}

export async function countDiscordWlSubmissions(campaignId: number): Promise<number> {
  const db = getSupabaseAdmin()
  const { count, error } = await db
    .from('discord_wl_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
  if (error) {
    console.error('countDiscordWlSubmissions:', error.message)
    return 0
  }
  return count ?? 0
}

export async function getDiscordWlSubmissionForUser(
  campaignId: number,
  discordUserId: string
): Promise<DiscordWlSubmissionRow | null> {
  const did = discordUserId.trim()
  if (!did) return null
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('discord_wl_submissions')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('discord_user_id', did)
    .maybeSingle()
  if (error || !data) return null
  return mapSubmission(data as Record<string, unknown>)
}

export async function getDiscordWlSubmissionForWallet(
  campaignId: number,
  wallet: string
): Promise<DiscordWlSubmissionRow | null> {
  const w = normalizeSolanaWalletAddress(wallet)
  if (!w) return null
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('discord_wl_submissions')
    .select('*')
    .eq('campaign_id', campaignId)
    .eq('wallet', w)
    .maybeSingle()
  if (error || !data) return null
  return mapSubmission(data as Record<string, unknown>)
}

export async function insertDiscordWlSubmission(input: {
  campaignId: number
  discordUserId: string
  discordUsername: string | null
  wallet: string
  source: 'linked_wallet' | 'modal'
}): Promise<
  | { ok: true; row: DiscordWlSubmissionRow }
  | { ok: false; code: 'user_taken' | 'wallet_taken' | 'db'; message: string }
> {
  const wallet = normalizeSolanaWalletAddress(input.wallet)
  if (!wallet) return { ok: false, code: 'db', message: 'Invalid wallet' }
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('discord_wl_submissions')
    .insert({
      campaign_id: input.campaignId,
      discord_user_id: input.discordUserId.trim(),
      discord_username: input.discordUsername?.trim().slice(0, 64) || null,
      wallet,
      source: input.source,
    })
    .select('*')
    .single()
  if (error) {
    const msg = (error.message ?? '').toLowerCase()
    if (msg.includes('discord_wl_submissions_user_unique') || msg.includes('(campaign_id, discord_user_id)')) {
      return { ok: false, code: 'user_taken', message: 'already' }
    }
    if (msg.includes('discord_wl_submissions_wallet_unique') || msg.includes('(campaign_id, wallet)')) {
      return { ok: false, code: 'wallet_taken', message: 'That wallet is already registered on this list by another account.' }
    }
    console.error('insertDiscordWlSubmission:', error.message)
    return { ok: false, code: 'db', message: 'Could not save your wallet. Try again in a moment.' }
  }
  return { ok: true, row: mapSubmission(data as Record<string, unknown>) }
}

export async function listDiscordWlSubmissions(campaignId: number): Promise<DiscordWlSubmissionRow[]> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('discord_wl_submissions')
    .select('*')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: true })
    .limit(5000)
  if (error) {
    console.error('listDiscordWlSubmissions:', error.message)
    return []
  }
  return (data ?? []).map((r) => mapSubmission(r as Record<string, unknown>))
}

export async function removeDiscordWlSubmission(input: {
  campaignId: number
  wallet?: string | null
  discordUserId?: string | null
}): Promise<{ ok: true; removed: number } | { ok: false; error: string }> {
  const db = getSupabaseAdmin()
  let q = db.from('discord_wl_submissions').delete().eq('campaign_id', input.campaignId)
  const wallet = input.wallet ? normalizeSolanaWalletAddress(input.wallet) : null
  const did = input.discordUserId?.trim()
  if (wallet) q = q.eq('wallet', wallet)
  else if (did) q = q.eq('discord_user_id', did)
  else return { ok: false, error: 'Provide a wallet or Discord member to remove.' }

  const { data, error } = await q.select('id')
  if (error) return { ok: false, error: error.message }
  return { ok: true, removed: (data ?? []).length }
}

export async function countDiscordWlSubmissionsByCampaignIds(
  campaignIds: number[]
): Promise<Record<number, number>> {
  const ids = [...new Set(campaignIds.filter((id) => Number.isFinite(id) && id > 0))]
  const out: Record<number, number> = {}
  for (const id of ids) out[id] = 0
  if (ids.length === 0) return out
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('discord_wl_submissions').select('campaign_id').in('campaign_id', ids)
  if (error) {
    console.error('countDiscordWlSubmissionsByCampaignIds:', error.message)
    return out
  }
  for (const row of data ?? []) {
    const id = Number((row as { campaign_id?: number }).campaign_id)
    if (Number.isFinite(id)) out[id] = (out[id] ?? 0) + 1
  }
  return out
}
