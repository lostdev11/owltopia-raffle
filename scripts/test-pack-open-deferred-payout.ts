/**
 * Pack open unlocks after reserve; vault payout is deferred via waitUntil.
 * Run: npx tsx scripts/test-pack-open-deferred-payout.ts
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PACK_OPEN_RECONCILE_PIPELINE_MIN_AGE_MS } from '../lib/packs/pack-open-reconcile'

function readRepoFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

const openRoute = readRepoFile('app/api/packs/open/route.ts')
assert.ok(openRoute.includes("from '@vercel/functions'"))
assert.ok(openRoute.includes('waitUntil'))
assert.ok(openRoute.includes('deferPayout: true'))
assert.ok(openRoute.includes('scheduleDeferredPackPayout'))
assert.ok(openRoute.includes('payoutCommittedPackOpen'))

const openEngine = readRepoFile('lib/packs/open-engine.ts')
assert.ok(openEngine.includes('deferPayout?: boolean'))
assert.ok(openEngine.includes('deferredPayout: true'))

// Reconcile should pick up stranded reserved/paying_out quickly after waitUntil fails.
assert.ok(PACK_OPEN_RECONCILE_PIPELINE_MIN_AGE_MS <= 60_000)
assert.ok(PACK_OPEN_RECONCILE_PIPELINE_MIN_AGE_MS >= 30_000)

console.log(
  JSON.stringify({
    ok: true,
    reconcileMinAgeMs: PACK_OPEN_RECONCILE_PIPELINE_MIN_AGE_MS,
  })
)
