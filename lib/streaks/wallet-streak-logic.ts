export type WalletStreakSnapshot = {
  winCurrentStreak: number
  winBestStreak: number
  winTotalWins: number
  participationCurrentStreak: number
  participationBestStreak: number
  lastParticipationDate: string | null
}

export type ParticipationStreakState = {
  currentStreak: number
  bestStreak: number
  lastParticipationDate: string | null
}

export type WinStreakState = {
  currentStreak: number
  bestStreak: number
  totalWins: number
}

/** UTC calendar date key (YYYY-MM-DD). */
export function utcDateKeyFromIso(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toISOString().slice(0, 10)
}

/** Day after `YYYY-MM-DD` in UTC. */
export function utcNextDateKey(dateKey: string): string {
  const ms = Date.parse(`${dateKey}T00:00:00.000Z`)
  if (!Number.isFinite(ms)) return dateKey
  return new Date(ms + 86_400_000).toISOString().slice(0, 10)
}

export function emptyWalletStreakSnapshot(): WalletStreakSnapshot {
  return {
    winCurrentStreak: 0,
    winBestStreak: 0,
    winTotalWins: 0,
    participationCurrentStreak: 0,
    participationBestStreak: 0,
    lastParticipationDate: null,
  }
}

/**
 * Participation streak: consecutive UTC days with at least one confirmed raffle entry.
 * Same-day entries are idempotent (no increment).
 */
export function applyParticipationEntry(
  prev: ParticipationStreakState | null,
  entryAtIso: string
): ParticipationStreakState {
  const entryDate = utcDateKeyFromIso(entryAtIso)
  if (!entryDate) {
    return prev ?? { currentStreak: 0, bestStreak: 0, lastParticipationDate: null }
  }

  if (!prev || !prev.lastParticipationDate) {
    return { currentStreak: 1, bestStreak: 1, lastParticipationDate: entryDate }
  }

  if (prev.lastParticipationDate === entryDate) {
    return prev
  }

  const expectedNext = utcNextDateKey(prev.lastParticipationDate)
  const currentStreak = entryDate === expectedNext ? prev.currentStreak + 1 : 1
  const bestStreak = Math.max(prev.bestStreak, currentStreak)
  return { currentStreak, bestStreak, lastParticipationDate: entryDate }
}

/**
 * Win streak: winner increments; every other entrant in the draw resets to 0.
 * `entrantPrimaryWallets` should already be deduped primary wallets.
 */
export function applyWinDraw(
  statesByWallet: Map<string, WinStreakState>,
  winnerPrimary: string,
  entrantPrimaryWallets: readonly string[]
): { winner: WinStreakState; updated: Map<string, WinStreakState> } {
  const winner = winnerPrimary.trim()
  const entrants = [...new Set(entrantPrimaryWallets.map((w) => w.trim()).filter(Boolean))]
  const updated = new Map<string, WinStreakState>()

  for (const wallet of entrants) {
    if (wallet === winner) continue
    const prev = statesByWallet.get(wallet) ?? { currentStreak: 0, bestStreak: 0, totalWins: 0 }
    updated.set(wallet, {
      currentStreak: 0,
      bestStreak: prev.bestStreak,
      totalWins: prev.totalWins,
    })
  }

  const prevWinner = statesByWallet.get(winner) ?? { currentStreak: 0, bestStreak: 0, totalWins: 0 }
  const currentStreak = prevWinner.currentStreak + 1
  const bestStreak = Math.max(prevWinner.bestStreak, currentStreak)
  const totalWins = prevWinner.totalWins + 1
  const winnerState = { currentStreak, bestStreak, totalWins }
  updated.set(winner, winnerState)

  return { winner: winnerState, updated }
}

/** Replay chronological draw outcomes for one participant wallet cluster. */
export function replayWinDrawsForParticipant(
  draws: ReadonlyArray<{ drawnAt: string; won: boolean }>
): WinStreakState {
  const sorted = [...draws].sort((a, b) => a.drawnAt.localeCompare(b.drawnAt))
  let currentStreak = 0
  let bestStreak = 0
  let totalWins = 0

  for (const draw of sorted) {
    if (draw.won) {
      currentStreak += 1
      totalWins += 1
      bestStreak = Math.max(bestStreak, currentStreak)
    } else {
      currentStreak = 0
    }
  }

  return { currentStreak, bestStreak, totalWins }
}

/** Replay sorted UTC participation dates to derive current/best streak as of today. */
export function replayParticipationDates(sortedUtcDateKeys: readonly string[]): ParticipationStreakState {
  if (sortedUtcDateKeys.length === 0) {
    return { currentStreak: 0, bestStreak: 0, lastParticipationDate: null }
  }

  let current = 0
  let best = 0
  let prev: string | null = null

  for (const day of sortedUtcDateKeys) {
    if (!day) continue
    if (!prev) {
      current = 1
    } else if (day === utcNextDateKey(prev)) {
      current += 1
    } else if (day === prev) {
      continue
    } else {
      current = 1
    }
    best = Math.max(best, current)
    prev = day
  }

  const lastParticipationDate = prev
  const today = utcDateKeyFromIso(new Date().toISOString())
  const streakStillActive =
    lastParticipationDate === today || lastParticipationDate === utcDateKeyFromIso(
      new Date(Date.now() - 86_400_000).toISOString()
    )

  return {
    currentStreak: streakStillActive ? current : 0,
    bestStreak: best,
    lastParticipationDate,
  }
}
