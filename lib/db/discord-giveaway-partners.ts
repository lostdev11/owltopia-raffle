import { createHash, randomBytes } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'
import type { DiscordGiveawayPartnerTenant } from '@/lib/types'

function mapRow(row: Record<string, unknown>): DiscordGiveawayPartnerTenant {
  return {
    id: String(row.id),
    name: String(row.name),
    discord_guild_id: row.discord_guild_id != null ? String(row.discord_guild_id) : null,
    webhook_url:
      row.webhook_url != null && String(row.webhook_url).trim() ? String(row.webhook_url).trim() : null,
    api_secret_hash: String(row.api_secret_hash),
    status: row.status as DiscordGiveawayPartnerTenant['status'],
    active_until: row.active_until != null ? String(row.active_until) : null,
    contact_note: row.contact_note != null ? String(row.contact_note) : null,
    created_by_wallet: row.created_by_wallet != null ? String(row.created_by_wallet) : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

function getPepper(): string {
  const p =
    process.env.DISCORD_GIVEAWAY_PARTNER_API_PEPPER?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    ''
  if (p.length < 16) {
    throw new Error(
      'DISCORD_GIVEAWAY_PARTNER_API_PEPPER or SESSION_SECRET (min 16 chars) is required for partner API keys'
    )
  }
  return p
}

export function generatePartnerApiSecret(): string {
  return `owlgw_${randomBytes(24).toString('hex')}`
}

export function hashPartnerApiSecret(secret: string): string {
  return createHash('sha256').update(`${getPepper()}\n${secret}`, 'utf8').digest('hex')
}

export async function findPartnerTenantByApiSecret(
  secret: string
): Promise<DiscordGiveawayPartnerTenant | null> {
  const hash = hashPartnerApiSecret(secret)
  const { data, error } = await getSupabaseAdmin()
    .from('discord_giveaway_partner_tenants')
    .select('*')
    .eq('api_secret_hash', hash)
    .maybeSingle()

  if (error) {
    console.error('findPartnerTenantByApiSecret:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

export function isPartnerTenantEntitled(t: DiscordGiveawayPartnerTenant): boolean {
  if (t.status === 'suspended') return false
  if (!t.active_until) return true
  const until = new Date(t.active_until).getTime()
  return Number.isFinite(until) && until > Date.now()
}

export async function listDiscordGiveawayPartners(): Promise<DiscordGiveawayPartnerTenant[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_giveaway_partner_tenants')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('listDiscordGiveawayPartners:', error.message)
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function getDiscordGiveawayPartnerByGuildId(
  guildId: string
): Promise<DiscordGiveawayPartnerTenant | null> {
  const g = guildId.trim()
  const { data, error } = await getSupabaseAdmin()
    .from('discord_giveaway_partner_tenants')
    .select('*')
    .eq('discord_guild_id', g)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('getDiscordGiveawayPartnerByGuildId:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function getDiscordGiveawayPartnerById(
  id: string
): Promise<DiscordGiveawayPartnerTenant | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_giveaway_partner_tenants')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('getDiscordGiveawayPartnerById:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

export type CreateDiscordGiveawayPartnerInput = {
  name: string
  webhook_url: string
  discord_guild_id?: string | null
  status?: DiscordGiveawayPartnerTenant['status']
  active_until?: string | null
  contact_note?: string | null
  created_by_wallet: string
}

export async function createDiscordGiveawayPartner(
  input: CreateDiscordGiveawayPartnerInput
): Promise<{ tenant: DiscordGiveawayPartnerTenant; apiSecret: string }> {
  const apiSecret = generatePartnerApiSecret()
  const api_secret_hash = hashPartnerApiSecret(apiSecret)

  const { data, error } = await getSupabaseAdmin()
    .from('discord_giveaway_partner_tenants')
    .insert({
      name: input.name.trim(),
      webhook_url: input.webhook_url.trim(),
      discord_guild_id: input.discord_guild_id?.trim() || null,
      api_secret_hash,
      status: input.status ?? 'trial',
      active_until: input.active_until ?? null,
      contact_note: input.contact_note?.trim() || null,
      created_by_wallet: input.created_by_wallet.trim(),
    })
    .select()
    .single()

  if (error) {
    console.error('createDiscordGiveawayPartner:', error.message)
    throw new Error(error.message)
  }
  return { tenant: mapRow(data as Record<string, unknown>), apiSecret }
}

/** After USDC payment via Discord slash (webhook URL added later with /webhook). */
export async function createSlashDiscordPartnerTenant(input: {
  guildId: string
  guildName: string
  subscriptionDays: number
}): Promise<{ tenant: DiscordGiveawayPartnerTenant; apiSecret: string }> {
  const apiSecret = generatePartnerApiSecret()
  const api_secret_hash = hashPartnerApiSecret(apiSecret)
  const active_until = new Date(
    Date.now() + input.subscriptionDays * 86400000
  ).toISOString()

  const { data, error } = await getSupabaseAdmin()
    .from('discord_giveaway_partner_tenants')
    .insert({
      name: input.guildName.trim() || `Discord server ${input.guildId}`,
      webhook_url: null,
      discord_guild_id: input.guildId.trim(),
      api_secret_hash,
      status: 'active',
      active_until,
      contact_note: 'discord-slash-usdc',
      created_by_wallet: 'discord:slash',
    })
    .select()
    .single()

  if (error) {
    console.error('createSlashDiscordPartnerTenant:', error.message)
    throw new Error(error.message)
  }
  return { tenant: mapRow(data as Record<string, unknown>), apiSecret }
}

export async function extendDiscordPartnerActiveDeadline(
  tenantId: string,
  additionalDays: number
): Promise<DiscordGiveawayPartnerTenant | null> {
  const cur = await getDiscordGiveawayPartnerById(tenantId)
  if (!cur) return null
  const now = Date.now()
  const prevEnd = cur.active_until ? new Date(cur.active_until).getTime() : now
  const base = Number.isFinite(prevEnd) ? Math.max(now, prevEnd) : now
  const next = new Date(base + additionalDays * 86400000).toISOString()
  return updateDiscordGiveawayPartner(tenantId, { active_until: next, status: 'active' })
}

export async function updateDiscordGiveawayPartner(
  id: string,
  patch: Partial<{
    name: string
    webhook_url: string | null
    discord_guild_id: string | null
    status: DiscordGiveawayPartnerTenant['status']
    active_until: string | null
    contact_note: string | null
  }>
): Promise<DiscordGiveawayPartnerTenant | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_giveaway_partner_tenants')
    .update(patch)
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) {
    console.error('updateDiscordGiveawayPartner:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

/** Regenerates API secret; returns new plain secret once. */
export async function rotateDiscordGiveawayPartnerSecret(
  id: string
): Promise<{ tenant: DiscordGiveawayPartnerTenant; apiSecret: string } | null> {
  const apiSecret = generatePartnerApiSecret()
  const api_secret_hash = hashPartnerApiSecret(apiSecret)

  const { data, error } = await getSupabaseAdmin()
    .from('discord_giveaway_partner_tenants')
    .update({ api_secret_hash })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) {
    console.error('rotateDiscordGiveawayPartnerSecret:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return { tenant: mapRow(data as Record<string, unknown>), apiSecret }
}
