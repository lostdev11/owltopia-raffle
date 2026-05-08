/**
 * Raffle thumbs up / down — Supabase-backed; writes use service role from API routes.
 * One row per (raffleId, wallet): UNIQUE + upsert so switching up/down replaces the prior vote (no double-count).
 */

import { supabase } from '@/lib/supabase'
import { getSupabaseAdmin, getSupabaseForServerRead } from '@/lib/supabase-admin'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'

function canonicalWalletAddress(wallet: string): string {
  const n = normalizeSolanaWalletAddress(wallet)
  return n ?? wallet.trim()
}

export type RaffleSentimentChoice = 'up' | 'down'

export type RaffleSentimentTotals = {
  up: number
  down: number
}

function db() {
  return getSupabaseForServerRead(supabase)
}

export async function getRaffleSentimentTotals(raffleId: string): Promise<RaffleSentimentTotals> {
  const empty: RaffleSentimentTotals = { up: 0, down: 0 }
  if (!raffleId) return empty

  const { data, error } = await db().from('raffle_sentiment').select('sentiment').eq('raffle_id', raffleId)

  if (error) {
    console.error('[raffle-sentiment] getRaffleSentimentTotals:', error.message)
    return empty
  }

  const totals = { ...empty }
  for (const raw of data ?? []) {
    const s = (raw as { sentiment?: string }).sentiment
    if (s === 'up') totals.up += 1
    else if (s === 'down') totals.down += 1
  }
  return totals
}

export async function getRaffleSentimentForWallet(
  raffleId: string,
  wallet: string
): Promise<RaffleSentimentChoice | null> {
  const w = canonicalWalletAddress(wallet)
  if (!raffleId || !w) return null

  const { data, error } = await db()
    .from('raffle_sentiment')
    .select('sentiment')
    .eq('raffle_id', raffleId)
    .eq('wallet_address', w)
    .maybeSingle()

  if (error || !data) return null
  const s = (data as { sentiment?: string }).sentiment
  return s === 'up' || s === 'down' ? s : null
}

export async function upsertRaffleSentiment(params: {
  raffleId: string
  wallet: string
  sentiment: RaffleSentimentChoice
}): Promise<{ ok: true } | { ok: false; message: string }> {
  const walletAddress = canonicalWalletAddress(params.wallet)
  if (!walletAddress) {
    return { ok: false, message: 'Invalid wallet address.' }
  }
  try {
    const admin = getSupabaseAdmin()
    const { error } = await admin.from('raffle_sentiment').upsert(
      {
        raffle_id: params.raffleId,
        wallet_address: walletAddress,
        sentiment: params.sentiment,
      },
      { onConflict: 'raffle_id,wallet_address' }
    )
    if (!error) return { ok: true }
    console.error('[raffle-sentiment] upsertRaffleSentiment:', error.message)
    return { ok: false, message: error.message || 'Could not save reaction.' }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not save reaction.' }
  }
}
