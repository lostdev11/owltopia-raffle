/**
 * Run: npx tsx scripts/test-discord-partner-command-access.ts
 */
import assert from 'node:assert/strict'
import {
  DISCORD_ADMINISTRATOR_BIT,
  DISCORD_MANAGE_GUILD_BIT,
  DISCORD_MANAGE_WEBHOOKS_BIT,
  memberHasDiscordPartnerManagePerms,
} from '../lib/discord/member-permissions'

assert.equal(memberHasDiscordPartnerManagePerms(undefined), false)
assert.equal(memberHasDiscordPartnerManagePerms(''), false)
assert.equal(memberHasDiscordPartnerManagePerms('0'), false)
assert.equal(memberHasDiscordPartnerManagePerms('not-a-bigint'), false)

assert.equal(memberHasDiscordPartnerManagePerms(String(DISCORD_ADMINISTRATOR_BIT)), true)
assert.equal(memberHasDiscordPartnerManagePerms(String(DISCORD_MANAGE_GUILD_BIT)), true)
assert.equal(memberHasDiscordPartnerManagePerms(String(DISCORD_MANAGE_WEBHOOKS_BIT)), true)
assert.equal(
  memberHasDiscordPartnerManagePerms(String(DISCORD_MANAGE_GUILD_BIT | DISCORD_MANAGE_WEBHOOKS_BIT)),
  true
)
// Send Messages only — not enough for mintlist lookup
assert.equal(memberHasDiscordPartnerManagePerms('2048'), false)

console.log('test-discord-partner-command-access: ok')
