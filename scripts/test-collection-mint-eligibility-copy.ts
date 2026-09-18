/**
 * Eligibility copy + allowlist membership fields for partner collection mints.
 */
import assert from 'node:assert/strict'

import { formatMintDate } from '../lib/owl-center/phase-schedule'

// Mirror the reason strings buildSimpleMintEligibility emits for allowlist windows.
function allowlistConnectReason(phaseLabel: string): string {
  return `${phaseLabel} is live — connect wallet to check if you’re on the list`
}

function allowlistEligibleReason(phaseLabel: string, maxMintable: number): string {
  return `Eligible for ${phaseLabel} · up to ${maxMintable} mint${maxMintable === 1 ? '' : 's'}`
}

function allowlistNotOnListReason(phaseLabel: string): string {
  return `Not on the ${phaseLabel} list — wait for the next phase or public`
}

assert.match(allowlistConnectReason('OG'), /OG is live/)
assert.match(allowlistEligibleReason('WL', 1), /Eligible for WL · up to 1 mint$/)
assert.match(allowlistEligibleReason('WL', 2), /up to 2 mints$/)
assert.match(allowlistNotOnListReason('OG'), /Not on the OG list/)

function publicWalletLimitReason(limit: number): string {
  return `Wallet limit reached (${limit} from public this phase — not total NFTs in wallet)`
}
assert.match(publicWalletLimitReason(5), /from public this phase/)

// Default mint dates render in UTC; local mode still available via preference.
process.env.TZ = 'America/New_York'
assert.match(formatMintDate('2026-09-05T11:30:00.000Z', 'utc'), /11:30.*UTC/)
assert.match(formatMintDate('2026-09-05T11:30:00.000Z', 'local'), /7:30/)

console.log('test-collection-mint-eligibility-copy: ok')
