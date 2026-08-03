import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type DiscordRaffleAlertSubscription = {
  discord_guild_id: string
  channel_id: string
  enabled: boolean
  configured_by_discord_user_id: string | null
  created_at: string
  updated_at: string
}

function mapRow(row: Record<string, unknown>): DiscordRaffleAlertSubscription {
  return {
    discord_guild_id: String(row.discord_guild_id),
    channel_id: String(row.channel_id),
    enabled: row.enabled !== false,
    configured_by_discord_user_id:
      row.configured_by_discord_user_id != null && String(row.configured_by_discord_user_id).trim()
        ? String(row.configured_by_discord_user_id).trim()
        : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }
}

export async function getDiscordRaffleAlertSubscription(
  guildId: string
): Promise<DiscordRaffleAlertSubscription | null> {
  const g = guildId.trim()
  if (!g) return null
  const { data, error } = await getSupabaseAdmin()
    .from('discord_raffle_alert_subscriptions')
    .select('*')
    .eq('discord_guild_id', g)
    .maybeSingle()

  if (error) {
    console.error('getDiscordRaffleAlertSubscription:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function listEnabledDiscordRaffleAlertSubscriptions(): Promise<
  DiscordRaffleAlertSubscription[]
> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_raffle_alert_subscriptions')
    .select('*')
    .eq('enabled', true)

  if (error) {
    console.error('listEnabledDiscordRaffleAlertSubscriptions:', error.message)
    throw new Error(error.message)
  }
  return (data ?? []).map((r) => mapRow(r as Record<string, unknown>))
}

export async function upsertDiscordRaffleAlertSubscription(params: {
  discord_guild_id: string
  channel_id: string
  configured_by_discord_user_id?: string | null
}): Promise<DiscordRaffleAlertSubscription> {
  const guildId = params.discord_guild_id.trim()
  const channelId = params.channel_id.trim()
  if (!guildId || !channelId) {
    throw new Error('discord_guild_id and channel_id are required')
  }

  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('discord_raffle_alert_subscriptions')
    .upsert(
      {
        discord_guild_id: guildId,
        channel_id: channelId,
        enabled: true,
        configured_by_discord_user_id: params.configured_by_discord_user_id?.trim() || null,
        updated_at: now,
      },
      { onConflict: 'discord_guild_id' }
    )
    .select('*')
    .single()

  if (error) {
    console.error('upsertDiscordRaffleAlertSubscription:', error.message)
    throw new Error(error.message)
  }
  return mapRow(data as Record<string, unknown>)
}

export async function disableDiscordRaffleAlertSubscription(guildId: string): Promise<boolean> {
  const g = guildId.trim()
  if (!g) return false
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('discord_raffle_alert_subscriptions')
    .update({ enabled: false, updated_at: now })
    .eq('discord_guild_id', g)
    .select('discord_guild_id')
    .maybeSingle()

  if (error) {
    console.error('disableDiscordRaffleAlertSubscription:', error.message)
    throw new Error(error.message)
  }
  return !!data
}

/**
 * Atomically claim fan-out for a public live raffle. Returns true only for the first claimer.
 */
export async function claimRaffleCommunityDiscordAlert(raffleId: string): Promise<boolean> {
  const id = raffleId.trim()
  if (!id) return false
  const now = new Date().toISOString()
  const { data, error } = await getSupabaseAdmin()
    .from('raffles')
    .update({ discord_community_alert_posted_at: now })
    .eq('id', id)
    .is('discord_community_alert_posted_at', null)
    .eq('list_on_platform', true)
    .eq('status', 'live')
    .eq('is_active', true)
    .select('id')
    .maybeSingle()

  if (error) {
    // Column may not exist yet on older DBs — log and skip fan-out rather than failing publish.
    console.error('claimRaffleCommunityDiscordAlert:', error.message)
    return false
  }
  return !!data
}
