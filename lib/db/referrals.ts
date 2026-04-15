import { randomBytes } from 'crypto'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'
import { ownsOwltopia } from '@/lib/platform-fees'
import { isReferralAttributionEnabled } from '@/lib/referrals/config'
import { purchaseMeetsReferralMinimum } from '@/lib/referrals/hardening'
import { referralAbuseAllowsNewRow } from '@/lib/db/referral-abuse'
import {
  isReservedReferralSlug,
  normalizeReferralCodeInput,
  normalizeVanitySlugForSet,
  REFERRAL_CODE_MAX_LEN,
  REFERRAL_CODE_MIN_LEN,
} from '@/lib/referrals/code-format'

export type WalletReferralCodeKind = 'random' | 'vanity'

const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
const RANDOM_CODE_LEN = 12

function randomReferralCode(): string {
  const bytes = randomBytes(RANDOM_CODE_LEN)
  let out = ''
  for (let i = 0; i < RANDOM_CODE_LEN; i++) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return out
}

async function insertRetiredCode(code: string, walletAddress: string): Promise<void> {
  const admin = getSupabaseAdmin()
  const { error } = await admin.from('referral_retired_codes').insert({
    code,
    wallet_address: walletAddress,
  })
  if (error?.code === '23505') return
  if (error) console.error('[referrals] insertRetiredCode:', error.message)
}

/**
 * Ensure wallet_referrals row exists with a unique random active_code.
 */
export async function ensureWalletReferralRow(walletAddress: string): Promise<void> {
  const w = walletAddress.trim()
  if (!w) return

  const admin = getSupabaseAdmin()
  const { data: existing, error: selErr } = await admin
    .from('wallet_referrals')
    .select('wallet_address')
    .eq('wallet_address', w)
    .maybeSingle()

  if (selErr) {
    console.error('[referrals] ensure select:', selErr.message)
    return
  }
  if (existing?.wallet_address) return

  for (let attempt = 0; attempt < 40; attempt++) {
    const code = randomReferralCode()
    const { error } = await admin.from('wallet_referrals').insert({
      wallet_address: w,
      active_code: code,
      code_kind: 'random',
      updated_at: new Date().toISOString(),
    })
    if (!error) return
    if (error.code === '23505') {
      const { data: raced } = await admin
        .from('wallet_referrals')
        .select('wallet_address')
        .eq('wallet_address', w)
        .maybeSingle()
      if (raced?.wallet_address) return
      continue
    }
    console.error('[referrals] ensure insert:', error.message)
    return
  }
  console.error('[referrals] ensure insert: exhausted retries')
}

export async function getReferralSummaryForWallet(
  walletAddress: string
): Promise<{ activeCode: string; codeKind: WalletReferralCodeKind } | null> {
  const w = walletAddress.trim()
  if (!w) return null

  const admin = getSupabaseAdmin()
  const { data, error } = await admin
    .from('wallet_referrals')
    .select('active_code, code_kind')
    .eq('wallet_address', w)
    .maybeSingle()

  if (error || !data?.active_code || !data.code_kind) return null
  const kind = data.code_kind === 'vanity' ? 'vanity' : 'random'
  return { activeCode: String(data.active_code), codeKind: kind }
}

/**
 * If the wallet is no longer an Owltopia holder but still has a vanity active code,
 * retire that code (never reused) and assign a new random active code.
 */
export async function syncReferralStateForWallet(walletAddress: string): Promise<void> {
  const w = walletAddress.trim()
  if (!w) return

  await ensureWalletReferralRow(w)

  const isHolder = await ownsOwltopia(w, { skipCache: true })
  if (isHolder) return

  const admin = getSupabaseAdmin()
  const { data: row, error: readErr } = await admin
    .from('wallet_referrals')
    .select('active_code, code_kind')
    .eq('wallet_address', w)
    .maybeSingle()

  if (readErr || !row || row.code_kind !== 'vanity' || !row.active_code) return

  const oldCode = String(row.active_code)

  for (let attempt = 0; attempt < 40; attempt++) {
    const newCode = randomReferralCode()
    const { data: updated, error: updErr } = await admin
      .from('wallet_referrals')
      .update({
        active_code: newCode,
        code_kind: 'random',
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', w)
      .eq('code_kind', 'vanity')
      .eq('active_code', oldCode)
      .select('active_code')
      .maybeSingle()

    if (updErr) {
      console.error('[referrals] sync downgrade update:', updErr.message)
      return
    }
    if (!updated) return

    await insertRetiredCode(oldCode, w)
    return
  }
}

export type PurchaseReferralResolution =
  | { referrerWallet: string; referralCodeUsed: string }
  | null

export type ReferralResolveContext = {
  amountPaid: number
  currency: string
  /** Skip minimum-purchase check (complimentary first-ticket flow still runs velocity limits). */
  complimentary?: boolean
}

/**
 * Resolve referral for a purchase: only active codes count; retired codes do not.
 * No self-referral. Optional ctx enforces minimum checkout size + 24h velocity caps.
 */
export async function resolveReferralForPurchase(
  rawCode: string | null | undefined,
  buyerWallet: string,
  ctx?: ReferralResolveContext
): Promise<PurchaseReferralResolution> {
  if (!isReferralAttributionEnabled()) return null

  const buyer = buyerWallet.trim()
  const normalized = normalizeReferralCodeInput(rawCode ?? '')
  if (!normalized || !buyer) return null

  const admin = getSupabaseAdmin()

  const { data: retired } = await admin
    .from('referral_retired_codes')
    .select('code')
    .eq('code', normalized)
    .maybeSingle()
  if (retired?.code) return null

  const { data: row, error } = await admin
    .from('wallet_referrals')
    .select('wallet_address')
    .eq('active_code', normalized)
    .maybeSingle()

  if (error || !row?.wallet_address) return null
  const referrer = String(row.wallet_address).trim()
  if (!referrer || referrer === buyer) return null

  if (ctx) {
    if (!ctx.complimentary && !purchaseMeetsReferralMinimum(ctx.currency, ctx.amountPaid)) return null
    const ok = await referralAbuseAllowsNewRow(buyer, referrer)
    if (!ok) return null
  }

  return { referrerWallet: referrer, referralCodeUsed: normalized }
}

export type SetVanityReferralCodeResult =
  | { ok: true; activeCode: string }
  | { ok: false; error: string }

/**
 * Holder-only: set vanity active_code. Retires the previous active code (any kind) so it is never reused.
 */
export async function setVanityReferralCode(
  walletAddress: string,
  rawSlug: string
): Promise<SetVanityReferralCodeResult> {
  const w = walletAddress.trim()
  const slug = normalizeVanitySlugForSet(rawSlug)
  if (!w) return { ok: false, error: 'Wallet required' }
  if (!slug) {
    return {
      ok: false,
      error: `Use ${REFERRAL_CODE_MIN_LEN}–${REFERRAL_CODE_MAX_LEN} characters: letters, numbers, underscore, hyphen.`,
    }
  }
  if (isReservedReferralSlug(slug)) {
    return { ok: false, error: 'That code is reserved. Pick another.' }
  }

  const isHolder = await ownsOwltopia(w, { skipCache: true })
  if (!isHolder) {
    return { ok: false, error: 'Custom links are for Owltopia NFT holders only.' }
  }

  await ensureWalletReferralRow(w)

  const admin = getSupabaseAdmin()

  const { data: taken } = await admin
    .from('wallet_referrals')
    .select('wallet_address')
    .eq('active_code', slug)
    .neq('wallet_address', w)
    .maybeSingle()
  if (taken?.wallet_address) {
    return { ok: false, error: 'That code is already taken.' }
  }

  const { data: retired } = await admin
    .from('referral_retired_codes')
    .select('code')
    .eq('code', slug)
    .maybeSingle()
  if (retired?.code) {
    return { ok: false, error: 'That code was used before and cannot be reused.' }
  }

  const { data: mine, error: readErr } = await admin
    .from('wallet_referrals')
    .select('active_code')
    .eq('wallet_address', w)
    .maybeSingle()

  if (readErr || !mine?.active_code) {
    return { ok: false, error: 'Could not load referral profile.' }
  }

  const previous = String(mine.active_code)
  if (previous === slug) {
    return { ok: true, activeCode: slug }
  }

  const { error: updErr } = await admin
    .from('wallet_referrals')
    .update({
      active_code: slug,
      code_kind: 'vanity',
      updated_at: new Date().toISOString(),
    })
    .eq('wallet_address', w)

  if (updErr) {
    if (updErr.code === '23505') {
      return { ok: false, error: 'That code is already taken.' }
    }
    console.error('[referrals] setVanity update:', updErr.message)
    return { ok: false, error: 'Could not update referral code.' }
  }

  await insertRetiredCode(previous, w)
  return { ok: true, activeCode: slug }
}

export type ReferralLeaderboardRow = {
  wallet_address: string
  referred_users: number
  referred_entries: number
}

/**
 * All-time stats from `referral_leaderboard_v1` (confirmed, non-refunded only).
 */
export async function getReferralLeaderboard(limit: number): Promise<ReferralLeaderboardRow[]> {
  const lim = Math.min(100, Math.max(1, Math.floor(limit)))
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('referral_leaderboard_v1')
    .select('wallet_address, referred_users, referred_entries')
    .order('referred_users', { ascending: false })
    .order('referred_entries', { ascending: false })
    .limit(lim)

  if (error) {
    console.error('[referrals] leaderboard:', error.message)
    return []
  }

  const out: ReferralLeaderboardRow[] = []
  for (const row of data ?? []) {
    const rec = row as Record<string, unknown>
    const w = String(rec.wallet_address ?? '').trim()
    if (!w) continue
    out.push({
      wallet_address: w,
      referred_users: Number(rec.referred_users ?? 0),
      referred_entries: Number(rec.referred_entries ?? 0),
    })
  }
  return out
}
