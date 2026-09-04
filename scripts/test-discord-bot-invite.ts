import assert from 'node:assert/strict'
import { buildDiscordBotInviteUrl } from '../lib/discord-bot-invite'

const url = buildDiscordBotInviteUrl('1490862347806314516')
assert.match(url, /client_id=1490862347806314516/)
assert.match(url, /permissions=2147503104/)
assert.match(url, /scope=bot(%20|\+)applications\.commands|scope=bot%20applications\.commands/)
assert.doesNotMatch(url, /\?client_id=[^&]+$/)

console.log('test-discord-bot-invite: ok')
console.log(url)
