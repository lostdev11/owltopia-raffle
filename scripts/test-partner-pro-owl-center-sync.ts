/**
 * Static + pure checks for Partner Program ↔ Owl Center launchpad sync.
 * Run: npx tsx scripts/test-partner-pro-owl-center-sync.ts
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PARTNER_PRO_OWL_CENTER_SYNC_NOTE,
  buildPartnerProOwlCenterSyncNotes,
  shouldReplacePartnerProOwlCenterNotes,
} from '../lib/partners/sync-owl-center-access-notes'

assert.equal(PARTNER_PRO_OWL_CENTER_SYNC_NOTE, 'Synced from Partner Program allowlist')
assert.equal(buildPartnerProOwlCenterSyncNotes(), PARTNER_PRO_OWL_CENTER_SYNC_NOTE)
assert.equal(
  buildPartnerProOwlCenterSyncNotes('application #42'),
  `${PARTNER_PRO_OWL_CENTER_SYNC_NOTE} (application #42)`
)
assert.equal(shouldReplacePartnerProOwlCenterNotes(null), true)
assert.equal(shouldReplacePartnerProOwlCenterNotes(''), true)
assert.equal(shouldReplacePartnerProOwlCenterNotes(PARTNER_PRO_OWL_CENTER_SYNC_NOTE), true)
assert.equal(
  shouldReplacePartnerProOwlCenterNotes(`${PARTNER_PRO_OWL_CENTER_SYNC_NOTE} (application #1)`),
  true
)
assert.equal(shouldReplacePartnerProOwlCenterNotes('Manual ops note — keep'), false)

const approveSrc = readFileSync(
  new URL('../lib/db/partner-program-applications.ts', import.meta.url),
  'utf8'
)
assert.ok(approveSrc.includes('grantOwlCenterAccessFromPartnerPro'))
assert.ok(approveSrc.includes('owl_center_granted'))

const creatorsSrc = readFileSync(
  new URL('../lib/db/partner-community-creators-admin.ts', import.meta.url),
  'utf8'
)
assert.ok(creatorsSrc.includes('grantOwlCenterAccessFromPartnerPro'))
assert.ok(creatorsSrc.includes('revokeOwlCenterAccessForPartnerWallet'))
assert.ok(creatorsSrc.includes('transferOwlCenterAccessForPartnerWalletRename'))

const retireSrc = readFileSync(new URL('../lib/partners/retire-partner.ts', import.meta.url), 'utf8')
assert.ok(retireSrc.includes('revokeOwlCenterAccessForPartnerWallet'))
assert.ok(retireSrc.includes('revokedOwlCenterWallets'))

const owlDbSrc = readFileSync(new URL('../lib/db/owl-center-partners.ts', import.meta.url), 'utf8')
assert.ok(owlDbSrc.includes('getOwlCenterPartnerByWallet'))
assert.ok(owlDbSrc.includes('revokeOwlCenterPartnerByWallet'))

const apiSrc = readFileSync(
  new URL('../app/api/admin/partner-applications/[id]/route.ts', import.meta.url),
  'utf8'
)
assert.ok(apiSrc.includes('owl_center_granted'))

const nestingClient = readFileSync(
  new URL('../components/admin/AdminPartnerNestingClient.tsx', import.meta.url),
  'utf8'
)
assert.ok(nestingClient.includes('/api/admin/partner-nesting'))
assert.ok(!nestingClient.includes('/api/admin/partners/nesting'))

const legacyGw = readFileSync(
  new URL('../app/admin/legacy-nft-giveaways/page.tsx', import.meta.url),
  'utf8'
)
assert.ok(legacyGw.includes('/api/admin/discord-giveaway-partners'))
assert.ok(!legacyGw.includes('/api/admin/partners/discord'))

console.log('test-partner-pro-owl-center-sync: ok')
