/**
 * Host filter + browse filter mitigations.
 * Run: npx tsx scripts/test-filter-browse-host.ts
 */
import assert from 'node:assert/strict'
import type { Raffle } from '../lib/types'
import {
  filterRafflesBrowseList,
  hasActiveBrowseFilters,
  hostWalletFilterFromSearchParam,
  raffleMatchesBrowseSearch,
  raffleMatchesHostFilter,
} from '../lib/raffles/filter-browse-raffles'
import {
  classifyHostResolve,
  collectHostCandidates,
  resolveHostCandidates,
  suggestHosts,
} from '../lib/raffles/resolve-host-filter'
import { buildRafflesHostBrowseHref } from '../lib/raffles/host-wallet-copy'

/** Fixed valid mainnet mint/program addresses (used only as stand-in wallets). */
const wDevA = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const wDevB = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const wOther = 'So11111111111111111111111111111111111111112'

function stubRaffle(partial: {
  id: string
  title: string
  creator_wallet: string
  creator_display_name?: string
  creator_partner_display_name?: string
}): Raffle {
  return {
    id: partial.id,
    slug: partial.id,
    title: partial.title,
    creator_wallet: partial.creator_wallet,
    created_by: null,
    creator_display_name: partial.creator_display_name ?? null,
    creator_partner_display_name: partial.creator_partner_display_name ?? null,
  } as Raffle
}

const raffles = [
  stubRaffle({
    id: '1',
    title: 'Owl Drop',
    creator_wallet: wDevA,
    creator_display_name: 'Devdad',
  }),
  stubRaffle({
    id: '2',
    title: 'Bamboo Bash',
    creator_wallet: wDevB,
    creator_display_name: 'Devdad',
  }),
  stubRaffle({
    id: '3',
    title: 'Solo Show',
    creator_wallet: wOther,
    creator_display_name: 'OtherHost',
    creator_partner_display_name: 'Partner Brand',
  }),
]

const candidates = collectHostCandidates(raffles)
assert.equal(candidates.length, 3)

// Wallet is the filter primitive
assert.equal(raffleMatchesHostFilter(raffles[0]!, wDevA), true)
assert.equal(raffleMatchesHostFilter(raffles[0]!, wDevB), false)
assert.equal(raffleMatchesHostFilter(raffles[0]!, null), true)

const filtered = filterRafflesBrowseList(
  raffles.map((raffle) => ({ raffle })),
  { query: '', ticketCurrency: null, prize: null, hostWallet: wDevA }
)
assert.equal(filtered.length, 1)
assert.equal(filtered[0]!.raffle.id, '1')

// `q` can match enriched display names (optional), host param still authoritative
assert.equal(raffleMatchesBrowseSearch(raffles[2]!, 'partner brand'), true)
assert.equal(raffleMatchesBrowseSearch(raffles[2]!, 'otherhost'), true)

// Ambiguous display name → many matches (picker)
const ambiguous = classifyHostResolve('Devdad', candidates)
assert.equal(ambiguous.status, 'many')
if (ambiguous.status === 'many') {
  assert.equal(ambiguous.hosts.length, 2)
}

// Unique name → one
const one = classifyHostResolve('OtherHost', candidates)
assert.equal(one.status, 'one')
if (one.status === 'one') {
  assert.equal(one.host.wallet, wOther)
}

// Exact wallet → one
const byWallet = resolveHostCandidates(wDevA, candidates)
assert.equal(byWallet.length, 1)
assert.equal(byWallet[0]!.wallet, wDevA)

// None
assert.equal(classifyHostResolve('Nobody', candidates).status, 'none')
assert.equal(classifyHostResolve('  ', candidates).status, 'empty')

// Typeahead capped
const suggestions = suggestHosts('dev', candidates, 8)
assert.ok(suggestions.length >= 1)
assert.ok(suggestions.length <= 8)

// URL host parse
assert.equal(hostWalletFilterFromSearchParam(wDevA), wDevA)
assert.equal(hostWalletFilterFromSearchParam(''), null)
assert.equal(hostWalletFilterFromSearchParam(null), null)

// Created By → browse deep link (wallet only; never display name)
assert.equal(buildRafflesHostBrowseHref(wDevA), `/raffles?host=${encodeURIComponent(wDevA)}`)
assert.equal(buildRafflesHostBrowseHref(''), null)
assert.equal(buildRafflesHostBrowseHref('  '), null)
assert.equal(
  buildRafflesHostBrowseHref({ creator_wallet: wDevA, created_by: null }),
  `/raffles?host=${encodeURIComponent(wDevA)}`
)
assert.equal(
  buildRafflesHostBrowseHref({ creator_wallet: null, created_by: wDevB }),
  `/raffles?host=${encodeURIComponent(wDevB)}`
)
assert.equal(buildRafflesHostBrowseHref({ creator_wallet: null, created_by: null }), null)

assert.equal(
  hasActiveBrowseFilters({
    query: '',
    ticketCurrency: null,
    prize: null,
    hostWallet: wDevA,
  }),
  true
)

console.log('filter-browse-host: ok')
