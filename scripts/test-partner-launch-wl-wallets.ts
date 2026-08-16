/**
 * Partner launch whitelist window + wallet text parsing.
 * Run: npx tsx scripts/test-partner-launch-wl-wallets.ts
 */
import assert from 'node:assert/strict'

import { parseWlWalletText } from '../lib/db/owl-center-launch-wl-wallets'
import {
  isLaunchWaitingForWhitelist,
  isLaunchWhitelistWindowOpen,
  isScheduledPhaseStartReached,
  launchHasWhitelistProgram,
} from '../lib/owl-center/launch-wl-window'
import type { OwlCenterLaunchPublic } from '../lib/owl-center/types'

const now = Date.parse('2026-08-20T12:00:00.000Z')
const past = '2026-08-18T12:00:00.000Z'
const future = '2026-08-24T12:00:00.000Z'
const later = '2026-08-26T12:00:00.000Z'

function baseLaunch(
  overrides: Partial<
    Pick<
      OwlCenterLaunchPublic,
      | 'creator_wl_enabled'
      | 'wl_supply'
      | 'phase_schedule'
      | 'launch_deadline_at'
      | 'is_paused'
      | 'active_phases'
    >
  > = {}
): Pick<
  OwlCenterLaunchPublic,
  | 'creator_wl_enabled'
  | 'wl_supply'
  | 'phase_schedule'
  | 'launch_deadline_at'
  | 'is_paused'
  | 'active_phases'
> {
  return {
    creator_wl_enabled: true,
    wl_supply: 100,
    phase_schedule: { WHITELIST: past, PUBLIC: later },
    launch_deadline_at: past,
    is_paused: false,
    active_phases: ['PUBLIC'],
    ...overrides,
  }
}

assert.equal(launchHasWhitelistProgram({ creator_wl_enabled: false, wl_supply: 0 }), false)
assert.equal(launchHasWhitelistProgram({ creator_wl_enabled: true, wl_supply: 0 }), true)
assert.equal(launchHasWhitelistProgram({ creator_wl_enabled: false, wl_supply: 5 }), true)

assert.equal(
  isScheduledPhaseStartReached(baseLaunch(), 'WHITELIST', now),
  true,
  'WL start in the past is reached'
)
assert.equal(
  isScheduledPhaseStartReached(baseLaunch(), 'PUBLIC', now),
  false,
  'PUBLIC start in the future is not reached'
)
assert.equal(
  isScheduledPhaseStartReached(baseLaunch({ phase_schedule: { WHITELIST: past } }), 'PUBLIC', now),
  false,
  'missing PUBLIC schedule is not reached'
)

assert.equal(
  isLaunchWaitingForWhitelist(baseLaunch({ phase_schedule: { WHITELIST: future, PUBLIC: later } }), now),
  true
)
assert.equal(isLaunchWaitingForWhitelist(baseLaunch(), now), false)

assert.equal(
  isLaunchWhitelistWindowOpen(baseLaunch(), now),
  true,
  'WL open and PUBLIC not yet — window open even if active_phases includes PUBLIC'
)
assert.equal(
  isLaunchWhitelistWindowOpen(
    baseLaunch({ phase_schedule: { WHITELIST: past, PUBLIC: past } }),
    now
  ),
  false,
  'PUBLIC schedule reached ends WL window'
)
assert.equal(
  isLaunchWhitelistWindowOpen(baseLaunch({ phase_schedule: { WHITELIST: past }, active_phases: ['PUBLIC'] }), now),
  true,
  'no PUBLIC schedule keeps WL window open (listed wallets only)'
)
assert.equal(
  isLaunchWhitelistWindowOpen(baseLaunch({ is_paused: true }), now),
  false
)
assert.equal(
  isLaunchWhitelistWindowOpen(baseLaunch({ creator_wl_enabled: false, wl_supply: 0 }), now),
  false
)

const wallets = parseWlWalletText(
  '7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY, 7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY\nnot-a-wallet\n'
)
assert.equal(wallets.length, 1)
assert.equal(wallets[0], '7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY')

console.log('ok — partner launch WL wallets helpers')
