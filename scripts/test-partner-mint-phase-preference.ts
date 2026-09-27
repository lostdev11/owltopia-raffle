/**
 * Partner mint phase preference helpers (buyer phase picker).
 * Run: npx --yes tsx scripts/test-partner-mint-phase-preference.ts
 */
import assert from 'node:assert/strict'

import {
  normalizePartnerMintPhasePreference,
  PARTNER_MINT_PUBLIC_PHASE_KEY,
} from '../lib/owl-center/partner-mint-phase-preference'

assert.equal(normalizePartnerMintPhasePreference(null), null)
assert.equal(normalizePartnerMintPhasePreference(undefined), null)
assert.equal(normalizePartnerMintPhasePreference(''), null)
assert.equal(normalizePartnerMintPhasePreference('   '), null)

assert.equal(normalizePartnerMintPhasePreference('public'), PARTNER_MINT_PUBLIC_PHASE_KEY)
assert.equal(normalizePartnerMintPhasePreference('PUBLIC'), PARTNER_MINT_PUBLIC_PHASE_KEY)
assert.equal(normalizePartnerMintPhasePreference('pub'), PARTNER_MINT_PUBLIC_PHASE_KEY)
assert.equal(normalizePartnerMintPhasePreference('Pub'), PARTNER_MINT_PUBLIC_PHASE_KEY)

assert.equal(normalizePartnerMintPhasePreference('wl'), 'wl')
assert.equal(normalizePartnerMintPhasePreference('WL'), 'wl')
assert.equal(normalizePartnerMintPhasePreference('Whitelist'), 'whitelist')
assert.equal(normalizePartnerMintPhasePreference('og'), 'og')
assert.equal(normalizePartnerMintPhasePreference('  team  '), 'team')

console.log('All partner mint phase preference checks passed.')
