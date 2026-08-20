/**
 * Partner Discord whitelist collection: wallet parse, submit rules, CSV, push mapping.
 * Run: npx tsx scripts/test-discord-wl-campaigns.ts
 */
import assert from 'node:assert/strict'

import { parseDiscordWlWalletInput, formatWalletShort } from '../lib/discord-wl/wallet-input'
import {
  evaluateDiscordWlSubmit,
  isDiscordWlFull,
  shouldRefreshCampaignEmbed,
  discordWlEmbedColor,
  formatCampaignListLine,
  discordWlPhaseLabel,
} from '../lib/discord-wl/campaign-rules'
import { buildDiscordWlExportCsv, mapPushWallets, discordWlWalletsPlaintext } from '../lib/discord-wl/csv'
import { parseOwlwlCustomId, wlComponentNeedsImmediateResponse } from '../lib/discord-wl/custom-id'

const SYS = '11111111111111111111111111111111'
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'

const parsedSys = parseDiscordWlWalletInput(SYS)
assert.equal(parsedSys.ok, true)
if (parsedSys.ok) assert.equal(parsedSys.wallet, SYS)

const evm = parseDiscordWlWalletInput('0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0')
assert.equal(evm.ok, false)
if (!evm.ok) {
  assert.equal(evm.code, 'evm')
  assert.match(evm.message, /Solana/i)
}

const junk = parseDiscordWlWalletInput('not-a-wallet')
assert.equal(junk.ok, false)
if (!junk.ok) assert.equal(junk.code, 'invalid')

assert.equal(formatWalletShort(TOKEN).includes('…'), true)

const baseSubmit = {
  status: 'open' as const,
  maxEntries: 100,
  currentCount: 10,
  requiredRoleId: null as string | null,
  requiredRoleName: null as string | null,
  memberRoleIds: [] as string[],
  existingByUserWallet: null as string | null,
  existingWalletOwnerUserId: null as string | null,
  discordUserId: 'user-1',
  walletRaw: SYS,
}

{
  const ok = evaluateDiscordWlSubmit(baseSubmit)
  assert.equal(ok.ok, true)
  if (ok.ok) assert.equal(ok.wallet, SYS)
}

{
  const closed = evaluateDiscordWlSubmit({ ...baseSubmit, status: 'closed' })
  assert.equal(closed.ok, false)
  if (!closed.ok) assert.equal(closed.code, 'closed')
}

{
  const full = evaluateDiscordWlSubmit({ ...baseSubmit, currentCount: 100 })
  assert.equal(full.ok, false)
  if (!full.ok) assert.equal(full.code, 'full')
}

{
  const already = evaluateDiscordWlSubmit({ ...baseSubmit, existingByUserWallet: SYS })
  assert.equal(already.ok, false)
  if (!already.ok) {
    assert.equal(already.code, 'already')
    assert.match(already.message, /already on this list/i)
  }
}

{
  const taken = evaluateDiscordWlSubmit({
    ...baseSubmit,
    existingWalletOwnerUserId: 'user-2',
  })
  assert.equal(taken.ok, false)
  if (!taken.ok) assert.equal(taken.code, 'wallet_taken')
}

{
  const role = evaluateDiscordWlSubmit({
    ...baseSubmit,
    requiredRoleId: 'og-role',
    requiredRoleName: 'OG',
    memberRoleIds: ['other'],
  })
  assert.equal(role.ok, false)
  if (!role.ok) {
    assert.equal(role.code, 'missing_role')
    assert.match(role.message, /@OG/)
  }
}

{
  const roleOk = evaluateDiscordWlSubmit({
    ...baseSubmit,
    requiredRoleId: 'og-role',
    requiredRoleName: 'OG',
    memberRoleIds: ['og-role'],
  })
  assert.equal(roleOk.ok, true)
}

{
  const evmSubmit = evaluateDiscordWlSubmit({ ...baseSubmit, walletRaw: '0xabc' })
  assert.equal(evmSubmit.ok, false)
  if (!evmSubmit.ok) assert.equal(evmSubmit.code, 'invalid')
}

{
  const evmFull = evaluateDiscordWlSubmit({
    ...baseSubmit,
    walletRaw: '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0',
  })
  assert.equal(evmFull.ok, false)
  if (!evmFull.ok) assert.equal(evmFull.code, 'evm')
}

assert.equal(isDiscordWlFull(100, 100), true)
assert.equal(isDiscordWlFull(null, 999), false)

assert.equal(
  shouldRefreshCampaignEmbed({
    previousCount: 9,
    nextCount: 10,
    becameClosed: false,
    becameOpen: false,
    maxEntries: 100,
  }),
  true
)
assert.equal(
  shouldRefreshCampaignEmbed({
    previousCount: 10,
    nextCount: 11,
    becameClosed: false,
    becameOpen: false,
    maxEntries: 100,
  }),
  false
)
assert.equal(
  shouldRefreshCampaignEmbed({
    previousCount: 10,
    nextCount: 11,
    becameClosed: true,
    becameOpen: false,
    maxEntries: 100,
  }),
  true
)

assert.equal(discordWlEmbedColor({ status: 'open', currentCount: 1, maxEntries: 100 }), 0x00ff9c)
assert.equal(discordWlEmbedColor({ status: 'closed', currentCount: 1, maxEntries: 100 }), 0x5c6773)
assert.equal(discordWlEmbedColor({ status: 'open', currentCount: 95, maxEntries: 100 }), 0xffd769)

assert.equal(discordWlPhaseLabel('og'), 'OG')
assert.equal(discordWlPhaseLabel('wl'), 'Whitelist')

const line = formatCampaignListLine({
  name: 'OG Whitelist',
  channelId: '123',
  status: 'open',
  currentCount: 47,
  maxEntries: 100,
})
assert.match(line, /OG Whitelist/)
assert.match(line, /#123/)
assert.match(line, /Open/)
assert.match(line, /47 \/ 100/)

const csv = buildDiscordWlExportCsv([
  {
    wallet: SYS,
    phase_key: 'og',
    discord_user_id: '1',
    discord_username: 'Owl,Fan',
    submitted_at: '2026-08-18T00:00:00.000Z',
    spots: 1,
  },
])
assert.match(csv, /wallet,phase_key/)
assert.match(csv, /"Owl,Fan"/)
assert.ok(csv.includes(SYS))

assert.equal(discordWlWalletsPlaintext([SYS, TOKEN]), `${SYS}\n${TOKEN}`)

const mapped = mapPushWallets({ wallets: [SYS, TOKEN], spotsPerWallet: 2, notePrefix: 'discord-wl' })
assert.equal(mapped.length, 2)
assert.equal(mapped[0]?.allowed_mints, 2)
assert.equal(mapped[0]?.note, 'discord-wl')
assert.equal(mapped[0]?.wallet, SYS)

const cid = parseOwlwlCustomId('owlwl:submit:42')
assert.equal(cid?.action, 'submit')
assert.equal(cid?.campaignId, 42)
assert.equal(wlComponentNeedsImmediateResponse('owlwl:submit:42'), true)
assert.equal(wlComponentNeedsImmediateResponse('owlwl:confirm:42'), false)
assert.equal(parseOwlwlCustomId('owlwl:hack:1'), null)

console.log('test-discord-wl-campaigns: ok')
