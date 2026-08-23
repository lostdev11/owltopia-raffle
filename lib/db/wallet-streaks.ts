import { getSupabaseAdmin } from '@/lib/supabase-admin'
import { leaderboardWalletIsExcluded } from '@/lib/leaderboard/hardening'
import { getPrimaryWalletForAddress } from '@/lib/db/wallet-links'
import { normalizeSolanaWalletAddress } from '@/lib/solana/normalize-wallet'
import {
  applyParticipationEntry,
  applyWinDraw,
  emptyWalletStreakSnapshot,
  replayParticipationDates,
  type WalletStreakSnapshot,
} from '@/lib/streaks/wallet-streak-logic'

type WalletStreakRow = {
  wallet_address: string
  win_current_streak: number
  win_best_streak: number
  win_total_wins: number
  last_win_at: string | null
  participation_current_streak: number
  participation_best_streak: number
  last_participation_date: string | null
  updated_at: string
}

function mapRow(row: WalletStreakRow | null | undefined): WalletStreakSnapshot {
  if (!row) return emptyWalletStreakSnapshot()
  return {
    winCurrentStreak: Number(row.win_current_streak) || 0,
    winBestStreak: Number(row.win_best_streak) || 0,
    winTotalWins: Number(row.win_total_wins) || 0,
    participationCurrentStreak: Number(row.participation_current_streak) || 0,
    participationBestStreak: Number(row.participation_best_streak) || 0,
    lastParticipationDate: row.last_participation_date ?? null,
  }
}

async function resolvePrimaryWallet(wallet: string): Promise<string | null> {
  const normalized = normalizeSolanaWalletAddress(wallet)
  if (!normalized || leaderboardWalletIsExcluded(normalized)) return null
  const primary = await getPrimaryWalletForAddress(normalized)
  return primary && !leaderboardWalletIsExcluded(primary) ? primary : null
}

async function loadStreakRows(wallets: string[]): Promise<Map<string, WalletStreakRow>> {
  const unique = [...new Set(wallets.map((w) => w.trim()).filter(Boolean))]
  if (unique.length === 0) return new Map()

  const { data, error } = await getSupabaseAdmin()
    .from('wallet_streaks')
    .select('*')
    .in('wallet_address', unique)

  if (error) {
    console.error('[wallet-streaks] load rows:', error.message)
    return new Map()
  }

  const map = new Map<string, WalletStreakRow>()
  for (const row of (data ?? []) as WalletStreakRow[]) {
    map.set(row.wallet_address, row)
  }
  return map
}

async function upsertStreakRow(
  wallet: string,
  patch: Partial<
    Pick<
      WalletStreakRow,
      | 'win_current_streak'
      | 'win_best_streak'
      | 'win_total_wins'
      | 'last_win_at'
      | 'participation_current_streak'
      | 'participation_best_streak'
      | 'last_participation_date'
    >
  >
): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await getSupabaseAdmin().from('wallet_streaks').upsert(
    {
      wallet_address: wallet,
      ...patch,
      updated_at: now,
    },
    { onConflict: 'wallet_address' }
  )
  if (error) {
    console.error('[wallet-streaks] upsert:', wallet, error.message)
  }
}

async function backfillParticipationFromHistory(wallet: string): Promise<ParticipationBackfill> {
  const cluster = await getParticipationDatesForWalletCluster(wallet)
  return replayParticipationDates(cluster)
}

type ParticipationBackfill = ReturnType<typeof replayParticipationDates>

async function getParticipationDatesForWalletCluster(primaryWallet: string): Promise<string[]> {
  const { getWalletClusterAddresses } = await import('@/lib/db/wallet-links')
  const cluster = await getWalletClusterAddresses(primaryWallet)
  if (cluster.length === 0) return []

  const dates = new Set<string>()
  const pageSize = 1000
  let from = 0

  while (true) {
    const { data, error } = await getSupabaseAdmin()
      .from('entries')
      .select('verified_at, created_at')
      .in('wallet_address', cluster)
      .eq('status', 'confirmed')
      .is('refunded_at', null)
      .order('verified_at', { ascending: true })
      .range(from, from + pageSize - 1)

    if (error) {
      console.error('[wallet-streaks] participation history:', error.message)
      break
    }

    for (const row of data ?? []) {
      const iso = (row.verified_at as string | null) ?? (row.created_at as string | null)
      if (!iso) continue
      const day = iso.slice(0, 10)
      if (day) dates.add(day)
    }

    if (!data || data.length < pageSize) break
    from += pageSize
  }

  return [...dates].sort()
}

export async function getWalletStreaks(wallet: string): Promise<WalletStreakSnapshot> {
  const primary = await resolvePrimaryWallet(wallet)
  if (!primary) return emptyWalletStreakSnapshot()

  const { data, error } = await getSupabaseAdmin()
    .from('wallet_streaks')
    .select('*')
    .eq('wallet_address', primary)
    .maybeSingle()

  if (error) {
    console.error('[wallet-streaks] get:', error.message)
    return emptyWalletStreakSnapshot()
  }

  if (data) {
    const row = data as WalletStreakRow
    if (!row.last_participation_date && Number(row.participation_current_streak) === 0) {
      const participation = await backfillParticipationFromHistory(primary)
      if (participation.lastParticipationDate) {
        await upsertStreakRow(primary, {
          win_current_streak: row.win_current_streak,
          win_best_streak: row.win_best_streak,
          win_total_wins: row.win_total_wins,
          last_win_at: row.last_win_at,
          participation_current_streak: participation.currentStreak,
          participation_best_streak: participation.bestStreak,
          last_participation_date: participation.lastParticipationDate,
        })
        return {
          ...mapRow(row),
          participationCurrentStreak: participation.currentStreak,
          participationBestStreak: participation.bestStreak,
          lastParticipationDate: participation.lastParticipationDate,
        }
      }
    }
    return mapRow(row)
  }

  const participation = await backfillParticipationFromHistory(primary)
  await upsertStreakRow(primary, {
    participation_current_streak: participation.currentStreak,
    participation_best_streak: participation.bestStreak,
    last_participation_date: participation.lastParticipationDate,
  })

  return {
    ...emptyWalletStreakSnapshot(),
    participationCurrentStreak: participation.currentStreak,
    participationBestStreak: participation.bestStreak,
    lastParticipationDate: participation.lastParticipationDate,
  }
}

/** Call after a raffle entry is confirmed (idempotent per UTC day). */
export async function recordParticipationStreakOnEntry(
  walletAddress: string,
  verifiedAtIso?: string | null
): Promise<void> {
  try {
    const primary = await resolvePrimaryWallet(walletAddress)
    if (!primary) return

    const entryAt = verifiedAtIso?.trim() || new Date().toISOString()
    const existingRows = await loadStreakRows([primary])
    const existing = existingRows.get(primary)

    const prev =
      existing != null
        ? {
            currentStreak: Number(existing.participation_current_streak) || 0,
            bestStreak: Number(existing.participation_best_streak) || 0,
            lastParticipationDate: existing.last_participation_date ?? null,
          }
        : await backfillParticipationFromHistory(primary)

    const next = applyParticipationEntry(prev, entryAt)
    if (
      existing &&
      next.currentStreak === Number(existing.participation_current_streak) &&
      next.lastParticipationDate === existing.last_participation_date
    ) {
      return
    }

    await upsertStreakRow(primary, {
      participation_current_streak: next.currentStreak,
      participation_best_streak: next.bestStreak,
      last_participation_date: next.lastParticipationDate,
    })
  } catch (err) {
    console.error('[wallet-streaks] record participation:', err)
  }
}

export type WinStreakDrawResult = {
  currentStreak: number
  totalWins: number
}

/**
 * Apply win streak updates for a completed draw. Idempotent via `drawKey`.
 * Returns winner streak stats for Discord announcements.
 */
export async function applyWinStreakOnDraw(params: {
  drawKey: string
  winnerWallet: string
  entrantWallets: readonly string[]
  drawnAt?: string
}): Promise<WinStreakDrawResult | null> {
  try {
    const drawKey = params.drawKey.trim()
    const winnerPrimary = await resolvePrimaryWallet(params.winnerWallet)
    if (!drawKey || !winnerPrimary) return null

    const admin = getSupabaseAdmin()
    const { data: existingEvent } = await admin
      .from('wallet_streak_draw_events')
      .select('winner_wallet')
      .eq('draw_key', drawKey)
      .maybeSingle()

    if (existingEvent) {
      const priorWinner = await resolvePrimaryWallet(String(existingEvent.winner_wallet))
      if (!priorWinner) return null
      const rows = await loadStreakRows([priorWinner])
      const row = rows.get(priorWinner)
      return {
        currentStreak: Number(row?.win_current_streak) || 0,
        totalWins: Number(row?.win_total_wins) || 0,
      }
    }

    const entrantPrimaries: string[] = []
    for (const wallet of params.entrantWallets) {
      const primary = await resolvePrimaryWallet(wallet)
      if (primary) entrantPrimaries.push(primary)
    }
    if (!entrantPrimaries.includes(winnerPrimary)) {
      entrantPrimaries.push(winnerPrimary)
    }

    const uniqueEntrants = [...new Set(entrantPrimaries)]
    const rows = await loadStreakRows(uniqueEntrants)
    const states = new Map(
      uniqueEntrants.map((wallet) => {
        const row = rows.get(wallet)
        return [
          wallet,
          {
            currentStreak: Number(row?.win_current_streak) || 0,
            bestStreak: Number(row?.win_best_streak) || 0,
            totalWins: Number(row?.win_total_wins) || 0,
          },
        ] as const
      })
    )

    const { winner, updated } = applyWinDraw(states, winnerPrimary, uniqueEntrants)
    const drawnAt = params.drawnAt?.trim() || new Date().toISOString()

    const { error: eventErr } = await admin.from('wallet_streak_draw_events').insert({
      draw_key: drawKey,
      winner_wallet: winnerPrimary,
    })
    if (eventErr) {
      if (eventErr.code === '23505') {
        const rowsAfterRace = await loadStreakRows([winnerPrimary])
        const row = rowsAfterRace.get(winnerPrimary)
        return {
          currentStreak: Number(row?.win_current_streak) || 0,
          totalWins: Number(row?.win_total_wins) || 0,
        }
      }
      console.error('[wallet-streaks] draw event insert:', eventErr.message)
      return null
    }

    for (const [wallet, state] of updated) {
      const prevRow = rows.get(wallet)
      let participationCurrent = Number(prevRow?.participation_current_streak) || 0
      let participationBest = Number(prevRow?.participation_best_streak) || 0
      let lastParticipationDate = prevRow?.last_participation_date ?? null
      if (!prevRow) {
        const participation = await backfillParticipationFromHistory(wallet)
        participationCurrent = participation.currentStreak
        participationBest = participation.bestStreak
        lastParticipationDate = participation.lastParticipationDate
      }
      await upsertStreakRow(wallet, {
        win_current_streak: state.currentStreak,
        win_best_streak: state.bestStreak,
        win_total_wins: state.totalWins,
        last_win_at: wallet === winnerPrimary ? drawnAt : prevRow?.last_win_at ?? null,
        participation_current_streak: participationCurrent,
        participation_best_streak: participationBest,
        last_participation_date: lastParticipationDate,
      })
    }

    return { currentStreak: winner.currentStreak, totalWins: winner.totalWins }
  } catch (err) {
    console.error('[wallet-streaks] apply win draw:', err)
    return null
  }
}

export async function applyCommunityGiveawayWinStreak(
  giveawayId: string,
  winnerWallet: string,
  entrantWallets: readonly string[],
  drawnAt?: string
): Promise<WinStreakDrawResult | null> {
  return applyWinStreakOnDraw({
    drawKey: `community-giveaway:${giveawayId}`,
    winnerWallet,
    entrantWallets,
    drawnAt,
  })
}

export async function applyRaffleWinStreak(
  raffleId: string,
  winnerWallet: string,
  entrantWallets: readonly string[],
  drawnAt?: string
): Promise<WinStreakDrawResult | null> {
  return applyWinStreakOnDraw({
    drawKey: `raffle:${raffleId}`,
    winnerWallet,
    entrantWallets,
    drawnAt,
  })
}
