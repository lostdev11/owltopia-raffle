import assert from 'node:assert/strict'
import {
  applyParticipationEntry,
  applyWinDraw,
  replayParticipationDates,
  replayWinDrawsForParticipant,
  utcDateKeyFromIso,
  utcNextDateKey,
} from '../lib/streaks/wallet-streak-logic'

assert.equal(utcDateKeyFromIso('2026-03-15T23:59:59.000Z'), '2026-03-15')
assert.equal(utcNextDateKey('2026-03-15'), '2026-03-16')

let participation = applyParticipationEntry(null, '2026-03-01T12:00:00.000Z')
assert.equal(participation.currentStreak, 1)
assert.equal(participation.bestStreak, 1)

participation = applyParticipationEntry(participation, '2026-03-01T18:00:00.000Z')
assert.equal(participation.currentStreak, 1, 'same UTC day is idempotent')

participation = applyParticipationEntry(participation, '2026-03-02T10:00:00.000Z')
assert.equal(participation.currentStreak, 2)

participation = applyParticipationEntry(participation, '2026-03-04T10:00:00.000Z')
assert.equal(participation.currentStreak, 1, 'gap resets streak')
assert.equal(participation.bestStreak, 2)

const replay = replayParticipationDates(['2026-03-01', '2026-03-02', '2026-03-04'])
assert.equal(replay.bestStreak, 2)

const states = new Map([
  ['winner', { currentStreak: 1, bestStreak: 1, totalWins: 1 }],
  ['loser', { currentStreak: 2, bestStreak: 2, totalWins: 2 }],
])
const winResult = applyWinDraw(states, 'winner', ['winner', 'loser'])
assert.equal(winResult.winner.currentStreak, 2, 'win after win increments streak')
assert.equal(winResult.winner.totalWins, 2)
assert.equal(winResult.updated.get('loser')?.currentStreak, 0, 'enter and lose resets streak')
assert.equal(winResult.updated.get('loser')?.totalWins, 2)

const winReplay = replayWinDrawsForParticipant([
  { drawnAt: '2026-01-01T00:00:00.000Z', won: true },
  { drawnAt: '2026-01-02T00:00:00.000Z', won: true },
  { drawnAt: '2026-01-03T00:00:00.000Z', won: false },
  { drawnAt: '2026-01-04T00:00:00.000Z', won: true },
])
assert.equal(winReplay.currentStreak, 1)
assert.equal(winReplay.bestStreak, 2)
assert.equal(winReplay.totalWins, 3)

const consecutiveWins = replayWinDrawsForParticipant([
  { drawnAt: '2026-02-01T00:00:00.000Z', won: true },
  { drawnAt: '2026-02-02T00:00:00.000Z', won: true },
])
assert.equal(consecutiveWins.currentStreak, 2)

console.log('wallet-streak-logic: all assertions passed')
