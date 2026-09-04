import type { WalletStreakSnapshot } from '@/lib/streaks/wallet-streak-logic'

export type DiscordWinnerStreakStats = {
  winCurrentStreak: number
  winTotalWins: number
  participationCurrentStreak?: number
}

export type DiscordEmbedField = {
  name: string
  value: string
  inline?: boolean
}

/**
 * Fields for raffle / community giveaway winner Discord embeds.
 * Always includes win totals; highlights active win/participation streaks.
 */
export function buildWinnerDiscordStreakFields(
  stats: DiscordWinnerStreakStats | null | undefined
): DiscordEmbedField[] {
  if (!stats) return []

  const winCurrent = Math.max(0, Math.floor(Number(stats.winCurrentStreak) || 0))
  const winTotal = Math.max(0, Math.floor(Number(stats.winTotalWins) || 0))
  const participation = Math.max(0, Math.floor(Number(stats.participationCurrentStreak) || 0))

  const fields: DiscordEmbedField[] = []

  if (winCurrent >= 2) {
    fields.push({
      name: 'Win streak',
      value: `🔥 ${winCurrent} wins in a row · ${winTotal} total`,
      inline: true,
    })
  } else if (winTotal > 0) {
    fields.push({
      name: 'Wins',
      value: `${winTotal} total win${winTotal === 1 ? '' : 's'}`,
      inline: true,
    })
  }

  if (participation >= 2) {
    fields.push({
      name: 'Entry streak',
      value: `📅 ${participation} day${participation === 1 ? '' : 's'} in a row`,
      inline: true,
    })
  }

  return fields
}

export function snapshotToDiscordWinnerStreakStats(
  snapshot: Pick<
    WalletStreakSnapshot,
    'winCurrentStreak' | 'winTotalWins' | 'participationCurrentStreak'
  > | null
): DiscordWinnerStreakStats | null {
  if (!snapshot) return null
  return {
    winCurrentStreak: snapshot.winCurrentStreak,
    winTotalWins: snapshot.winTotalWins,
    participationCurrentStreak: snapshot.participationCurrentStreak,
  }
}
