import assert from 'node:assert/strict'
import {
  isPaidPartnerApplyTier,
  normalizePartnerCommunityHttpsUrl,
  parsePartnerApplyTier,
} from '../lib/partner-program-apply'

assert.equal(parsePartnerApplyTier('partner_pro'), 'partner_pro')
assert.equal(parsePartnerApplyTier('pro'), 'partner_pro')
assert.equal(parsePartnerApplyTier('white_label'), 'white_label')
assert.equal(parsePartnerApplyTier('wl'), 'white_label')
assert.equal(parsePartnerApplyTier('$0_partner'), '$0_partner')
assert.equal(parsePartnerApplyTier('nope'), null)
assert.equal(parsePartnerApplyTier(' partner_pro '), 'partner_pro')

assert.equal(isPaidPartnerApplyTier('partner_pro'), true)
assert.equal(isPaidPartnerApplyTier('white_label'), true)
assert.equal(isPaidPartnerApplyTier('$0_partner'), false)

assert.equal(normalizePartnerCommunityHttpsUrl('https://discord.gg/nRD2wyg2vq'), 'https://discord.gg/nRD2wyg2vq')
const pastedInvite = normalizePartnerCommunityHttpsUrl('discord.gg/nRD2wyg2vq')
assert.ok(pastedInvite?.startsWith('https://discord.gg/nRD2wyg2vq'))
assert.equal(normalizePartnerCommunityHttpsUrl('http://example.com'), null)
assert.equal(normalizePartnerCommunityHttpsUrl('javascript:alert(1)'), null)
assert.equal(normalizePartnerCommunityHttpsUrl(''), null)

console.log('test-partner-program-apply: ok')
