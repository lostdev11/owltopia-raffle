import assert from 'node:assert/strict'
import { buildWinnerDiscordStreakFields } from '../lib/discord-winner-streak-fields'

assert.deepEqual(buildWinnerDiscordStreakFields(null), [])
assert.deepEqual(buildWinnerDiscordStreakFields(undefined), [])

const firstWin = buildWinnerDiscordStreakFields({
  winCurrentStreak: 1,
  winTotalWins: 1,
  participationCurrentStreak: 1,
})
assert.equal(firstWin.length, 1)
assert.equal(firstWin[0]!.name, 'Wins')
assert.match(firstWin[0]!.value, /1 total win/)

const hotStreak = buildWinnerDiscordStreakFields({
  winCurrentStreak: 3,
  winTotalWins: 5,
  participationCurrentStreak: 4,
})
assert.equal(hotStreak.length, 2)
assert.equal(hotStreak[0]!.name, 'Win streak')
assert.match(hotStreak[0]!.value, /3 wins in a row/)
assert.equal(hotStreak[1]!.name, 'Entry streak')
assert.match(hotStreak[1]!.value, /4 days in a row/)

console.log('discord-winner-streak-fields: all assertions passed')
