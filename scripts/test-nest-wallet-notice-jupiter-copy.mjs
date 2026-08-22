/**
 * Copy regression: Jupiter nest-freeze warning wording must stay explicit for first-timers.
 * Reads source as text so it runs without node_modules.
 * Run: node scripts/test-nest-wallet-notice-jupiter-copy.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const notice = readFileSync(join(root, 'lib/nesting/nest-wallet-notice.ts'), 'utf8')
const security = readFileSync(join(root, 'lib/nesting/security-notice-content.ts'), 'utf8')
const faq = readFileSync(join(root, 'components/nesting/NestingLandingClient.tsx'), 'utf8')
const cost = readFileSync(join(root, 'components/nesting/NestCostSummary.tsx'), 'utf8')

assert.match(notice, /flagged as malicious/)
assert.match(notice, /permission to spend your tokens/)
assert.match(notice, /does not move SOL, USDC/)
assert.match(notice, /nest freeze address/)
assert.match(security, /Jupiter/)
assert.match(security, /permission to spend your tokens/)
assert.match(faq, /flagged as malicious/)
assert.match(cost, /permission to spend/)

console.log('ok — Jupiter nest wallet notice copy covers the scanner warning')
