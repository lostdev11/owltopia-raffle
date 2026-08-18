/**
 * Unit tests for raffle slug sanitization (phishing-shaped path hygiene).
 * Run: npx tsx scripts/test-raffle-slugify.ts
 */
import assert from 'node:assert/strict'
import { basicSlugifyTitle, sanitizeRaffleSlug, slugifyRaffleTitle } from '../lib/raffles/slugify'
import {
  canonicalRaffleSlug,
  raffleSlugNeedsRedirect,
  raffleSlugStorageCandidates,
} from '../lib/raffles/slug-aliases'

assert.equal(slugifyRaffleTitle('Legendary Dumpster #14'), 'dumpster-14')
assert.equal(slugifyRaffleTitle('Legendary Dragon NFT'), 'raffle')
assert.equal(slugifyRaffleTitle('NPP #3967'), 'npp-3967')
assert.equal(slugifyRaffleTitle('Free Mint Airdrop Claim Now'), 'raffle')
assert.equal(slugifyRaffleTitle('GOATS #862'), 'goats-862')
assert.equal(slugifyRaffleTitle('Epic Transmission'), 'epic-transmission')
assert.equal(sanitizeRaffleSlug('legendary-dumpster-14'), 'dumpster-14')
assert.equal(sanitizeRaffleSlug('metamask-claim-nft'), 'raffle')
assert.equal(basicSlugifyTitle('Legendary Dumpster #14'), 'legendary-dumpster-14')

assert.equal(canonicalRaffleSlug('legendary-dumpster-14'), 'dumpster-14')
assert.equal(canonicalRaffleSlug('dumpster-14'), 'dumpster-14')
assert.equal(raffleSlugNeedsRedirect('legendary-dumpster-14'), 'dumpster-14')
assert.equal(raffleSlugNeedsRedirect('dumpster-14'), null)
assert.deepEqual(raffleSlugStorageCandidates('dumpster-14'), [
  'dumpster-14',
  'legendary-dumpster-14',
])
assert.deepEqual(raffleSlugStorageCandidates('legendary-dumpster-14'), [
  'legendary-dumpster-14',
  'dumpster-14',
])

console.log('test-raffle-slugify: ok')
