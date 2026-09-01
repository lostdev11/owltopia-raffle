/**
 * One-time backfill for wallet win streak columns from historical draws.
 * Participation streaks backfill separately on dashboard load.
 *
 * Usage: npx --yes tsx --env-file=.env.local scripts/backfill-wallet-win-streaks.ts
 */
import { getSupabaseAdmin } from '../lib/supabase-admin'
import { replayWinDrawsForParticipant } from '../lib/streaks/wallet-streak-logic'
import { leaderboardWalletIsExcluded } from '../lib/leaderboard/hardening'
import { normalizeSolanaWalletAddress } from '../lib/solana/normalize-wallet'

const PAGE = 1000

function clusterWon(cluster: Set<string>, winner: string | null | undefined): boolean {
  const w = normalizeSolanaWalletAddress(winner ?? '')
  return !!w && cluster.has(w)
}

async function main(): Promise<void> {
  const wallets = new Set<string>()
  let from = 0
  while (true) {
    const { data, error } = await getSupabaseAdmin()
      .from('entries')
      .select('wallet_address')
      .eq('status', 'confirmed')
      .is('refunded_at', null)
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data ?? []) {
      const w = normalizeSolanaWalletAddress(String(row.wallet_address ?? ''))
      if (w && !leaderboardWalletIsExcluded(w)) wallets.add(w)
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }

  from = 0
  while (true) {
    const { data, error } = await getSupabaseAdmin()
      .from('community_giveaway_entries')
      .select('wallet_address')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data ?? []) {
      const w = normalizeSolanaWalletAddress(String(row.wallet_address ?? ''))
      if (w && !leaderboardWalletIsExcluded(w)) wallets.add(w)
    }
    if (!data || data.length < PAGE) break
    from += PAGE
  }

  let updated = 0
  for (const wallet of wallets) {
    const cluster = new Set([wallet])
    const draws: Array<{ drawnAt: string; won: boolean }> = []

    const { data: entryRows } = await getSupabaseAdmin()
      .from('entries')
      .select('raffle_id')
      .eq('wallet_address', wallet)
      .eq('status', 'confirmed')
      .is('refunded_at', null)

    const raffleIds = [...new Set((entryRows ?? []).map((r) => String(r.raffle_id)).filter(Boolean))]
    if (raffleIds.length > 0) {
      const { data: raffles } = await getSupabaseAdmin()
        .from('raffles')
        .select('winner_wallet, winner_selected_at, status')
        .in('id', raffleIds)
        .not('winner_wallet', 'is', null)
        .not('winner_selected_at', 'is', null)
      for (const raffle of raffles ?? []) {
        const status = String(raffle.status ?? '').toLowerCase()
        if (status !== 'completed' && status !== 'successful_pending_claims') continue
        draws.push({
          drawnAt: String(raffle.winner_selected_at),
          won: clusterWon(cluster, raffle.winner_wallet as string),
        })
      }
    }

    const { data: giveawayEntryRows } = await getSupabaseAdmin()
      .from('community_giveaway_entries')
      .select('giveaway_id')
      .eq('wallet_address', wallet)

    const giveawayIds = [
      ...new Set((giveawayEntryRows ?? []).map((r) => String(r.giveaway_id)).filter(Boolean)),
    ]
    if (giveawayIds.length > 0) {
      const { data: giveaways } = await getSupabaseAdmin()
        .from('community_giveaways')
        .select('winner_wallet, winner_selected_at, status')
        .in('id', giveawayIds)
        .eq('status', 'drawn')
        .not('winner_wallet', 'is', null)
      for (const giveaway of giveaways ?? []) {
        const drawnAt = String(giveaway.winner_selected_at ?? '').trim()
        if (!drawnAt) continue
        draws.push({
          drawnAt,
          won: clusterWon(cluster, giveaway.winner_wallet as string),
        })
      }
    }

    const wins = replayWinDrawsForParticipant(draws)
    if (wins.totalWins === 0 && wins.bestStreak === 0) continue

    const { error: upsertErr } = await getSupabaseAdmin().from('wallet_streaks').upsert(
      {
        wallet_address: wallet,
        win_current_streak: wins.currentStreak,
        win_best_streak: wins.bestStreak,
        win_total_wins: wins.totalWins,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' }
    )
    if (upsertErr) {
      console.error('upsert failed for', wallet, upsertErr.message)
      continue
    }
    updated += 1
  }

  console.log(`Backfilled win streaks for ${updated} wallets (scanned ${wallets.size}).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
