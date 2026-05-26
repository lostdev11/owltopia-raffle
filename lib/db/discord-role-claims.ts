import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type Gen2DiscordRoleType = 'gen2_presale' | 'gen2_whitelist'
export type DiscordRoleClaimStatus = 'pending' | 'granted' | 'failed'

export type DiscordRoleClaimRow = {
  id: string
  wallet_address: string
  discord_id: string
  role_type: Gen2DiscordRoleType
  status: DiscordRoleClaimStatus
  error_message: string | null
  created_at: string
  updated_at: string
}

export async function getGrantedDiscordRoleClaim(
  wallet: string,
  roleType: Gen2DiscordRoleType
): Promise<DiscordRoleClaimRow | null> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('discord_role_claims')
    .select('*')
    .eq('wallet_address', wallet.trim())
    .eq('role_type', roleType)
    .eq('status', 'granted')
    .maybeSingle()

  if (error) {
    console.error('getGrantedDiscordRoleClaim:', error.message)
    return null
  }
  return data ? (data as DiscordRoleClaimRow) : null
}

export async function getDiscordRoleClaimsForWallet(wallet: string): Promise<DiscordRoleClaimRow[]> {
  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('discord_role_claims')
    .select('*')
    .eq('wallet_address', wallet.trim())
    .order('created_at', { ascending: false })

  if (error) {
    console.error('getDiscordRoleClaimsForWallet:', error.message)
    return []
  }
  return (data ?? []) as DiscordRoleClaimRow[]
}

export async function insertDiscordRoleClaimPending(input: {
  walletAddress: string
  discordId: string
  roleType: Gen2DiscordRoleType
}): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const admin = getSupabaseAdmin()
  const now = new Date().toISOString()
  const { data, error } = await admin
    .from('discord_role_claims')
    .insert({
      wallet_address: input.walletAddress.trim(),
      discord_id: input.discordId.trim(),
      role_type: input.roleType,
      status: 'pending',
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return { ok: false, message: 'You have already claimed this role.' }
    }
    console.error('insertDiscordRoleClaimPending:', error.message)
    return { ok: false, message: error.message }
  }

  return { ok: true, id: String((data as { id: string }).id) }
}

export async function updateDiscordRoleClaimStatus(
  id: string,
  status: 'granted' | 'failed',
  errorMessage?: string | null
): Promise<void> {
  const admin = getSupabaseAdmin()
  const { error } = await admin
    .from('discord_role_claims')
    .update({
      status,
      error_message: errorMessage?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    console.error('updateDiscordRoleClaimStatus:', error.message)
  }
}

export async function listDiscordRoleClaimsForAdmin(limit: number): Promise<DiscordRoleClaimRow[]> {
  const admin = getSupabaseAdmin()
  const cap = Math.min(500, Math.max(1, Math.floor(limit)))
  const { data, error } = await admin
    .from('discord_role_claims')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(cap)

  if (error) {
    console.error('listDiscordRoleClaimsForAdmin:', error.message)
    return []
  }
  return (data ?? []) as DiscordRoleClaimRow[]
}
