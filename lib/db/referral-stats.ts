import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { supabase } from '@/lib/supabase'
import { getDisplayNamesByWallets } from '@/lib/db/wallet-profiles'
import { purchaseMeetsReferralMinimum } from '@/lib/referrals/hardening'
import type { RaffleReferralPromoterRow, RaffleReferralStats } from '@/lib/referrals/types'

export type { RaffleReferralPromoterRow, RaffleReferralStats }

type EntryAggRow = {
  referral_code_used: string | null
  referrer_wallet: string | null
  ticket_quantity: number
  amount_paid: number
  currency: string
}

function shortWallet(w: string): string {
  const t = w.trim()
  if (t.length <= 12) return t
  return `${t.slice(0, 4)}…${t.slice(-4)}`
}

/**
 * Per-raffle referral leaderboard: confirmed, non-refunded entries with referrer attribution.
 */
export async function getRaffleReferralStats(raffleId: string): Promise<RaffleReferralStats> {
  const db = getSupabaseForServerRead(supabase)
  const { data, error } = await db
    .from('entries')
    .select('referral_code_used, referrer_wallet, ticket_quantity, amount_paid, currency')
    .eq('raffle_id', raffleId)
    .eq('status', 'confirmed')
    .is('refunded_at', null)
    .not('referrer_wallet', 'is', null)

  if (error || !data?.length) {
    if (error) console.error('[referral-stats] getRaffleReferralStats:', error.message)
    return { promoters: [] }
  }

  const byKey = new Map<
    string,
    { code: string; wallet: string; tickets: number; volume: Record<string, number> }
  >()

  for (const raw of data as EntryAggRow[]) {
    const wallet = raw.referrer_wallet?.trim()
    if (!wallet) continue
    const code = raw.referral_code_used?.trim() || wallet
    const key = code.toLowerCase()
    const qty = Number(raw.ticket_quantity)
    if (!Number.isFinite(qty) || qty <= 0) continue
    const amount = Number(raw.amount_paid)
    const cur = (raw.currency || 'SOL').toUpperCase()
    if (!purchaseMeetsReferralMinimum(cur, amount) && amount > 0) continue

    let row = byKey.get(key)
    if (!row) {
      row = { code, wallet, tickets: 0, volume: {} }
      byKey.set(key, row)
    }
    row.tickets += qty
    if (Number.isFinite(amount) && amount > 0) {
      row.volume[cur] = (row.volume[cur] ?? 0) + amount
    }
  }

  const sorted = [...byKey.values()].sort((a, b) => {
    if (b.tickets !== a.tickets) return b.tickets - a.tickets
    const volA = Object.values(a.volume).reduce((s, n) => s + n, 0)
    const volB = Object.values(b.volume).reduce((s, n) => s + n, 0)
    return volB - volA
  })

  const wallets = sorted.map((r) => r.wallet)
  const names = wallets.length ? await getDisplayNamesByWallets(wallets) : {}

  const promoters: RaffleReferralPromoterRow[] = sorted.map((row, i) => ({
    rank: i + 1,
    referralCode: row.code,
    displayName: names[row.wallet]?.trim() || null,
    ticketsReferred: row.tickets,
    referredVolume: row.volume,
  }))

  return { promoters }
}

export { shortWallet as shortReferrerWalletForDisplay }
