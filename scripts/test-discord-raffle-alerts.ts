/**
 * Lightweight unit checks for Discord raffle-alert eligibility helpers.
 * Run: npx --yes tsx scripts/test-discord-raffle-alerts.ts
 */
import assert from 'node:assert/strict'

function isEligibleForCommunityRaffleAlert(raffle: {
  list_on_platform?: boolean
  is_active?: boolean
  status?: string
  end_time: string
}): boolean {
  if (raffle.list_on_platform === false) return false
  if (raffle.is_active === false) return false
  if (raffle.status !== 'live') return false
  const endMs = new Date(raffle.end_time).getTime()
  if (Number.isFinite(endMs) && endMs <= Date.now()) return false
  return true
}

const future = new Date(Date.now() + 86_400_000).toISOString()
const past = new Date(Date.now() - 86_400_000).toISOString()

assert.equal(
  isEligibleForCommunityRaffleAlert({
    list_on_platform: true,
    is_active: true,
    status: 'live',
    end_time: future,
  }),
  true
)

assert.equal(
  isEligibleForCommunityRaffleAlert({
    list_on_platform: false,
    is_active: true,
    status: 'live',
    end_time: future,
  }),
  false
)

assert.equal(
  isEligibleForCommunityRaffleAlert({
    list_on_platform: true,
    is_active: true,
    status: 'draft',
    end_time: future,
  }),
  false
)

assert.equal(
  isEligibleForCommunityRaffleAlert({
    list_on_platform: true,
    is_active: false,
    status: 'live',
    end_time: future,
  }),
  false
)

assert.equal(
  isEligibleForCommunityRaffleAlert({
    list_on_platform: true,
    is_active: true,
    status: 'live',
    end_time: past,
  }),
  false
)

console.log('test-discord-raffle-alerts: ok')
