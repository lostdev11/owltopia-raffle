import assert from 'node:assert/strict'
import { isPartnerTenantEntitled } from '../lib/db/discord-giveaway-partners'
import type { DiscordGiveawayPartnerTenant } from '../lib/types'

function base(partial: Partial<DiscordGiveawayPartnerTenant>): DiscordGiveawayPartnerTenant {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Test',
    discord_guild_id: '1368549684393807974',
    webhook_url: null,
    raffle_webhook_url_created: null,
    raffle_webhook_url_winner: null,
    api_secret_hash: 'x',
    status: 'active',
    active_until: null,
    contact_note: null,
    created_by_wallet: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...partial,
  }
}

assert.equal(isPartnerTenantEntitled(base({ status: 'active', active_until: '2000-01-01T00:00:00.000Z' })), true)
assert.equal(isPartnerTenantEntitled(base({ status: 'active', active_until: null })), true)
assert.equal(isPartnerTenantEntitled(base({ status: 'suspended' })), false)
assert.equal(isPartnerTenantEntitled(base({ status: 'trial', active_until: '2000-01-01T00:00:00.000Z' })), false)
assert.equal(isPartnerTenantEntitled(base({ status: 'trial', active_until: '2099-01-01T00:00:00.000Z' })), true)
assert.equal(isPartnerTenantEntitled(base({ status: 'trial', active_until: null })), true)

console.log('test-partner-tenant-entitlement: ok')
