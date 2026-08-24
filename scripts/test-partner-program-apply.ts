import assert from 'node:assert/strict'
import {
  isPaidPartnerApplyTier,
  normalizePartnerCommunityHttpsUrl,
  parsePartnerApplyTier,
  ZERO_PARTNER_APPLY_HREF,
  PARTNER_PRO_APPLY_HREF,
  WHITE_LABEL_APPLY_HREF,
} from '../lib/partner-program-apply'

assert.equal(parsePartnerApplyTier('partner_pro'), 'partner_pro')
assert.equal(parsePartnerApplyTier('pro'), 'partner_pro')
assert.equal(parsePartnerApplyTier('white_label'), 'white_label')
assert.equal(parsePartnerApplyTier('wl'), 'white_label')
assert.equal(parsePartnerApplyTier('$0_partner'), '$0_partner')
assert.equal(parsePartnerApplyTier('0'), '$0_partner')
assert.equal(parsePartnerApplyTier('free'), '$0_partner')
assert.equal(parsePartnerApplyTier('nope'), null)
assert.equal(parsePartnerApplyTier(' partner_pro '), 'partner_pro')

assert.equal(ZERO_PARTNER_APPLY_HREF, '/partner-program?tier=0#partner-apply')
assert.equal(PARTNER_PRO_APPLY_HREF, '/partner-program?tier=pro#partner-apply')
assert.equal(WHITE_LABEL_APPLY_HREF, '/partner-program?tier=wl#partner-apply')
assert.equal(parsePartnerApplyTier(new URL(ZERO_PARTNER_APPLY_HREF, 'https://example.com').searchParams.get('tier')), '$0_partner')

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
