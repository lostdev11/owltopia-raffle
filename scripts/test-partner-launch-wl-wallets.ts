/**
 * Partner launch whitelist window + multi-phase allowlists + wallet text parsing.
 * Run: npx tsx scripts/test-partner-launch-wl-wallets.ts
 */
import assert from 'node:assert/strict'

import { parseWlWalletText } from '../lib/db/owl-center-launch-wl-wallets'
import {
  getLaunchActiveAllowlistPhase,
  isLaunchWaitingForWhitelist,
  isLaunchWhitelistWindowOpen,
  isScheduledPhaseStartReached,
  launchHasWhitelistProgram,
} from '../lib/owl-center/launch-wl-window'
import {
  getActivePartnerAllowlistPhase,
  nextPresetForPhases,
  partnerAllowlistPhasesFromFormRows,
  resolvePartnerAllowlistPhases,
} from '../lib/owl-center/partner-allowlist-phases'
import { datetimeLocalToIso } from '../lib/owl-center/phase-schedule'
import type { OwlCenterLaunchPublic } from '../lib/owl-center/types'

const now = Date.parse('2026-08-20T12:00:00.000Z')
const past = '2026-08-18T12:00:00.000Z'
const mid = '2026-08-19T12:00:00.000Z'
const future = '2026-08-24T12:00:00.000Z'
const later = '2026-08-26T12:00:00.000Z'

function baseLaunch(
  overrides: Partial<
    Pick<
      OwlCenterLaunchPublic,
      | 'creator_wl_enabled'
      | 'wl_supply'
      | 'wl_price_usdc'
      | 'partner_allowlist_phases'
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
  | 'wl_price_usdc'
  | 'partner_allowlist_phases'
  | 'phase_schedule'
  | 'launch_deadline_at'
  | 'is_paused'
  | 'active_phases'
> {
  return {
    creator_wl_enabled: true,
    wl_supply: 100,
    wl_price_usdc: 30,
    partner_allowlist_phases: [],
    phase_schedule: { WHITELIST: past, PUBLIC: later },
    launch_deadline_at: past,
    is_paused: false,
    active_phases: ['PUBLIC'],
    ...overrides,
  }
}

assert.equal(launchHasWhitelistProgram({ creator_wl_enabled: false, wl_supply: 0, partner_allowlist_phases: [] }), false)
assert.equal(launchHasWhitelistProgram({ creator_wl_enabled: true, wl_supply: 0, partner_allowlist_phases: [] }), true)
assert.equal(launchHasWhitelistProgram({ creator_wl_enabled: false, wl_supply: 5, partner_allowlist_phases: [] }), true)

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
  isLaunchWhitelistWindowOpen(baseLaunch({ phase_schedule: { WHITELIST: past, PUBLIC: past } }), now),
  false,
  'PUBLIC schedule reached ends WL window'
)
assert.equal(isLaunchWhitelistWindowOpen(baseLaunch({ is_paused: true }), now), false)

const multi = baseLaunch({
  partner_allowlist_phases: [
    { key: 'team', label: 'Team', starts_at: past, supply: 10, price_usdc: 0 },
    { key: 'og', label: 'OG', starts_at: mid, supply: 40, price_usdc: 15 },
    { key: 'wl', label: 'Whitelist', starts_at: future, supply: 100, price_usdc: 30 },
  ],
  phase_schedule: { PUBLIC: later },
})

assert.equal(getActivePartnerAllowlistPhase(multi, now)?.key, 'og', 'mid window → OG active')
assert.equal(getLaunchActiveAllowlistPhase(multi, Date.parse(past) + 1000)?.key, 'team')
assert.equal(getActivePartnerAllowlistPhase(multi, Date.parse(later) + 1000), null, 'public open → no allowlist')

const resolved = resolvePartnerAllowlistPhases({
  creator_wl_enabled: true,
  wl_supply: 50,
  wl_price_usdc: 20,
  phase_schedule: { WHITELIST: past },
  partner_allowlist_phases: [],
})
assert.equal(resolved.length, 1)
assert.equal(resolved[0]!.key, 'wl')

const fromForm = partnerAllowlistPhasesFromFormRows(
  [
    { key: 'team', label: 'Team', start: '2026-08-18T12:00', supply: '10', price: '0' },
    { key: 'wl', label: 'WL', start: '2026-08-20T12:00', supply: '100', price: '30' },
  ],
  datetimeLocalToIso
)
assert.ok(!('error' in fromForm))
assert.equal(fromForm.length, 2)

const preset = nextPresetForPhases([{ key: 'team', label: 'Team', start: '', supply: '', price: '' }])
assert.equal(preset.key, 'og')

const wallets = parseWlWalletText(
  '7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY, 7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY\nnot-a-wallet\n'
)
assert.equal(wallets.length, 1)
assert.equal(wallets[0], '7YxQg8HkwvH1L6iuY28JNWzJ96GWEx4qD8CK4M6nYkAY')

console.log('ok — partner launch WL wallets + multi-phase helpers')
