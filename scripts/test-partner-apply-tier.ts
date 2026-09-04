import assert from 'node:assert/strict'
import {
  isPaidPartnerApplyTier,
  normalizePartnerCommunityHttpsUrl,
  parsePartnerApplyTier,
} from '../lib/partner-program-apply'

assert.equal(parsePartnerApplyTier('pro'), 'partner_pro')
assert.equal(parsePartnerApplyTier('partner_pro'), 'partner_pro')
assert.equal(parsePartnerApplyTier('wl'), 'white_label')
assert.equal(parsePartnerApplyTier('white-label'), 'white_label')
assert.equal(parsePartnerApplyTier('0'), '$0_partner')
assert.equal(parsePartnerApplyTier('free'), '$0_partner')
assert.equal(parsePartnerApplyTier('nope'), null)
assert.equal(isPaidPartnerApplyTier('partner_pro'), true)
assert.equal(isPaidPartnerApplyTier('$0_partner'), false)
assert.equal(normalizePartnerCommunityHttpsUrl('discord.gg/abc'), 'https://discord.gg/abc')
assert.equal(normalizePartnerCommunityHttpsUrl('https://owltopia.xyz'), 'https://owltopia.xyz/')
assert.equal(normalizePartnerCommunityHttpsUrl('http://example.com'), null)
assert.equal(normalizePartnerCommunityHttpsUrl(''), null)

console.log('test-partner-apply-tier: ok')
