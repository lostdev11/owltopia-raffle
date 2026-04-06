import { randomBytes } from 'crypto'
import { getSupabaseAdmin } from '@/lib/supabase-admin'

export type PaymentIntentStatus = 'pending' | 'confirmed' | 'expired' | 'superseded'

export interface DiscordPartnerPaymentIntent {
  id: string
  reference_code: string
  discord_guild_id: string
  discord_guild_name: string | null
  amount_usdc: number
  memo: string
  status: PaymentIntentStatus
  confirmed_signature: string | null
  partner_tenant_id: string | null
  created_at: string
  expires_at: string
}

function mapRow(row: Record<string, unknown>): DiscordPartnerPaymentIntent {
  return {
    id: String(row.id),
    reference_code: String(row.reference_code),
    discord_guild_id: String(row.discord_guild_id),
    discord_guild_name: row.discord_guild_name != null ? String(row.discord_guild_name) : null,
    amount_usdc: Number(row.amount_usdc),
    memo: String(row.memo),
    status: row.status as PaymentIntentStatus,
    confirmed_signature: row.confirmed_signature != null ? String(row.confirmed_signature) : null,
    partner_tenant_id: row.partner_tenant_id != null ? String(row.partner_tenant_id) : null,
    created_at: String(row.created_at),
    expires_at: String(row.expires_at),
  }
}

function generateReferenceCode(): string {
  return randomBytes(6).toString('hex').toUpperCase()
}

/** Mark existing pending intents for this guild as superseded, then insert a new pending intent. */
export async function createPendingPaymentIntent(params: {
  discord_guild_id: string
  discord_guild_name: string | null
  amount_usdc: number
  ttlHours: number
}): Promise<DiscordPartnerPaymentIntent> {
  const reference_code = generateReferenceCode()
  const memo = `OWLGW:${reference_code}`
  const expires_at = new Date(Date.now() + params.ttlHours * 60 * 60 * 1000).toISOString()

  await getSupabaseAdmin()
    .from('discord_partner_payment_intents')
    .update({ status: 'superseded' })
    .eq('discord_guild_id', params.discord_guild_id)
    .eq('status', 'pending')

  const { data, error } = await getSupabaseAdmin()
    .from('discord_partner_payment_intents')
    .insert({
      reference_code,
      discord_guild_id: params.discord_guild_id,
      discord_guild_name: params.discord_guild_name,
      amount_usdc: params.amount_usdc,
      memo,
      status: 'pending',
      expires_at,
    })
    .select()
    .single()

  if (error) {
    console.error('createPendingPaymentIntent:', error.message)
    throw new Error(error.message)
  }
  return mapRow(data as Record<string, unknown>)
}

export async function getPendingIntentForGuild(
  guildId: string
): Promise<DiscordPartnerPaymentIntent | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_partner_payment_intents')
    .select('*')
    .eq('discord_guild_id', guildId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('getPendingIntentForGuild:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  const row = mapRow(data as Record<string, unknown>)
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await getSupabaseAdmin()
      .from('discord_partner_payment_intents')
      .update({ status: 'expired' })
      .eq('id', row.id)
    return null
  }
  return row
}

export async function findIntentByMemo(memo: string): Promise<DiscordPartnerPaymentIntent | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_partner_payment_intents')
    .select('*')
    .eq('memo', memo)
    .eq('status', 'pending')
    .maybeSingle()

  if (error) {
    console.error('findIntentByMemo:', error.message)
    throw new Error(error.message)
  }
  if (!data) return null
  return mapRow(data as Record<string, unknown>)
}

export async function markIntentConfirmed(
  intentId: string,
  signature: string,
  partnerTenantId: string
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from('discord_partner_payment_intents')
    .update({
      status: 'confirmed',
      confirmed_signature: signature,
      partner_tenant_id: partnerTenantId,
    })
    .eq('id', intentId)

  if (error) {
    console.error('markIntentConfirmed:', error.message)
    throw new Error(error.message)
  }
}

export async function isSignatureAlreadyUsed(signature: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from('discord_partner_payment_intents')
    .select('id')
    .eq('confirmed_signature', signature)
    .maybeSingle()

  if (error) {
    console.error('isSignatureAlreadyUsed:', error.message)
    return true
  }
  return !!data
}
