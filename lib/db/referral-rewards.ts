import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { ownsOwltopia } from '@/lib/platform-fees'
import { invalidateReferralProgramEnabledCache } from '@/lib/referrals/config'

export type ReferralRewardMode = 'free_entry' | 'owl_token' | 'disabled'
export type ReferralRewardStatus = 'pending' | 'confirmed' | 'expired' | 'void'
export type ReferralRewardRecipientRole = 'buyer' | 'referrer'

export type ReferralRewardSettingsRow = {
  id: string
  program_enabled: boolean
  reward_mode: ReferralRewardMode
  campaign_key: string
  campaign_starts_at: string | null
  campaign_ends_at: string | null
  owl_reward_amount: number | null
  monthly_cap_holder: number
  monthly_cap_non_holder: number
  buyer_complimentary_enabled: boolean
  allow_multiple_per_campaign: boolean
  updated_at: string
  updated_by_wallet: string | null
}

export type ReferralRewardRow = {
  id: string
  campaign_key: string
  calendar_month: string
  reward_recipient_role: ReferralRewardRecipientRole
  raffle_id: string | null
  referrer_wallet: string
  referral_code: string
  referred_wallet: string | null
  reward_mode: ReferralRewardMode
  reward_status: ReferralRewardStatus
  trigger_entry_id: string | null
  free_entry_id: string | null
  owl_reward_amount: number | null
  owl_reward_tx_signature: string | null
  referrer_is_holder_at_issue: boolean | null
  issued_at: string
  confirmed_at: string | null
  expired_at: string | null
  voided_at: string | null
  created_at: string
}

const SETTINGS_ID = 'default'

export function utcCalendarMonthKey(d = new Date()): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function nextUtcMonthStartIso(d = new Date()): string {
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0, 0))
  return next.toISOString()
}

export async function getReferralRewardSettings(): Promise<ReferralRewardSettingsRow> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('referral_reward_settings')
    .select('*')
    .eq('id', SETTINGS_ID)
    .maybeSingle()

  if (error) {
    console.error('[referral-rewards] get settings:', error.message)
  }

  if (data) return data as ReferralRewardSettingsRow

  return {
    id: SETTINGS_ID,
    program_enabled: true,
    reward_mode: 'free_entry',
    campaign_key: 'default',
    campaign_starts_at: null,
    campaign_ends_at: null,
    owl_reward_amount: null,
    monthly_cap_holder: 5,
    monthly_cap_non_holder: 1,
    buyer_complimentary_enabled: false,
    allow_multiple_per_campaign: false,
    updated_at: new Date().toISOString(),
    updated_by_wallet: null,
  }
}

export async function getReferrerMonthlyCap(referrerWallet: string): Promise<number> {
  const settings = await getReferralRewardSettings()
  const isHolder = await ownsOwltopia(referrerWallet.trim(), { skipCache: true })
  return isHolder ? settings.monthly_cap_holder : settings.monthly_cap_non_holder
}

export async function countReferrerRewardsThisMonth(
  referrerWallet: string,
  monthKey = utcCalendarMonthKey()
): Promise<number> {
  const w = referrerWallet.trim()
  if (!w) return 0

  const db = getSupabaseAdmin()
  const { count, error } = await db
    .from('referral_rewards')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_wallet', w)
    .eq('reward_recipient_role', 'referrer')
    .eq('calendar_month', monthKey)
    .in('reward_status', ['pending', 'confirmed'])

  if (error) {
    console.error('[referral-rewards] count month:', error.message)
    return 0
  }
  return count ?? 0
}

export async function getReferrerMonthlyUsage(referrerWallet: string): Promise<{
  cap: number
  used: number
  remaining: number
  isHolder: boolean
  monthKey: string
  resetsAt: string
}> {
  const w = referrerWallet.trim()
  const monthKey = utcCalendarMonthKey()
  const [cap, used, isHolder] = await Promise.all([
    getReferrerMonthlyCap(w),
    countReferrerRewardsThisMonth(w, monthKey),
    ownsOwltopia(w, { skipCache: true }),
  ])
  const remaining = Math.max(0, cap - used)
  return {
    cap,
    used,
    remaining,
    isHolder,
    monthKey,
    resetsAt: nextUtcMonthStartIso(),
  }
}

export async function hasBuyerReferralRewardForWallet(referredWallet: string): Promise<boolean> {
  const w = referredWallet.trim()
  if (!w) return false
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('referral_rewards')
    .select('id')
    .eq('referred_wallet', w)
    .eq('reward_recipient_role', 'buyer')
    .in('reward_status', ['pending', 'confirmed'])
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[referral-rewards] hasBuyer:', error.message)
    return false
  }
  return Boolean(data?.id)
}

export async function countConfirmedEntriesForWallet(wallet: string): Promise<number> {
  const w = wallet.trim()
  if (!w) return 0
  const db = getSupabaseAdmin()
  const { count, error } = await db
    .from('entries')
    .select('id', { count: 'exact', head: true })
    .eq('wallet_address', w)
    .eq('status', 'confirmed')
    .is('refunded_at', null)

  if (error) {
    console.error('[referral-rewards] count confirmed entries:', error.message)
    return 0
  }
  return count ?? 0
}

export async function insertReferralReward(row: {
  campaign_key: string
  calendar_month: string
  reward_recipient_role: ReferralRewardRecipientRole
  raffle_id: string | null
  referrer_wallet: string
  referral_code: string
  referred_wallet: string | null
  reward_mode: ReferralRewardMode
  trigger_entry_id: string
  referrer_is_holder_at_issue?: boolean | null
}): Promise<ReferralRewardRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('referral_rewards')
    .insert({
      ...row,
      reward_status: 'pending',
      issued_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    console.error('[referral-rewards] insert:', error.message)
    return null
  }
  return data as ReferralRewardRow
}

export async function getReferralRewardById(id: string): Promise<ReferralRewardRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db.from('referral_rewards').select('*').eq('id', id).maybeSingle()
  if (error || !data) return null
  return data as ReferralRewardRow
}

export async function listPendingReferralRewardsForWallet(
  wallet: string
): Promise<ReferralRewardRow[]> {
  const w = wallet.trim()
  if (!w) return []
  const db = getSupabaseAdmin()
  const [buyerRes, referrerRes] = await Promise.all([
    db
      .from('referral_rewards')
      .select('*')
      .eq('reward_status', 'pending')
      .eq('reward_mode', 'free_entry')
      .eq('referred_wallet', w)
      .eq('reward_recipient_role', 'buyer')
      .order('issued_at', { ascending: false }),
    db
      .from('referral_rewards')
      .select('*')
      .eq('reward_status', 'pending')
      .eq('reward_mode', 'free_entry')
      .eq('referrer_wallet', w)
      .eq('reward_recipient_role', 'referrer')
      .order('issued_at', { ascending: false }),
  ])

  if (buyerRes.error) console.error('[referral-rewards] list pending buyer:', buyerRes.error.message)
  if (referrerRes.error) {
    console.error('[referral-rewards] list pending referrer:', referrerRes.error.message)
  }

  const merged = [...(buyerRes.data ?? []), ...(referrerRes.data ?? [])] as ReferralRewardRow[]
  merged.sort((a, b) => new Date(b.issued_at).getTime() - new Date(a.issued_at).getTime())
  return merged
}

export async function markReferralRewardConfirmed(
  rewardId: string,
  freeEntryId: string
): Promise<void> {
  const now = new Date().toISOString()
  const db = getSupabaseAdmin()
  const { error } = await db
    .from('referral_rewards')
    .update({
      reward_status: 'confirmed',
      confirmed_at: now,
      free_entry_id: freeEntryId,
    })
    .eq('id', rewardId)

  if (error) console.error('[referral-rewards] mark confirmed:', error.message)
}

export async function updateReferralRewardSettings(
  patch: Partial<
      Pick<
      ReferralRewardSettingsRow,
      | 'program_enabled'
      | 'reward_mode'
      | 'campaign_key'
      | 'campaign_starts_at'
      | 'campaign_ends_at'
      | 'owl_reward_amount'
      | 'monthly_cap_holder'
      | 'monthly_cap_non_holder'
      | 'buyer_complimentary_enabled'
      | 'allow_multiple_per_campaign'
    >
  >,
  updatedByWallet: string
): Promise<ReferralRewardSettingsRow | null> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('referral_reward_settings')
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      updated_by_wallet: updatedByWallet,
    })
    .eq('id', SETTINGS_ID)
    .select('*')
    .single()

  if (error) {
    console.error('[referral-rewards] update settings:', error.message)
    return null
  }
  invalidateReferralProgramEnabledCache()
  return data as ReferralRewardSettingsRow
}
