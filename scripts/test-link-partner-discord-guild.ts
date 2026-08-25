import assert from 'node:assert/strict'
import { normalizeDiscordGuildId } from '../lib/admin/link-partner-discord-guild'

assert.equal(normalizeDiscordGuildId('1368549684393807974'), '1368549684393807974')
assert.equal(normalizeDiscordGuildId(' 1368549684393807974 '), '1368549684393807974')
assert.equal(normalizeDiscordGuildId('abc'), null)
assert.equal(normalizeDiscordGuildId('123'), null)
assert.equal(normalizeDiscordGuildId(''), null)

console.log('test-link-partner-discord-guild: ok')
