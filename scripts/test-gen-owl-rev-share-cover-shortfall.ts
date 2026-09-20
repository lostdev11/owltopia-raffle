/**
 * Coverage top-up amount helper (no RPC).
 * Run: npx tsx scripts/test-gen-owl-rev-share-cover-shortfall.ts
 */
import assert from 'node:assert/strict'
import {
  GEN_OWL_REV_SHARE_COVER_SHORTFALL_BUFFER_SOL,
  suggestedGenOwlRevShareCoverShortfallSol,
} from '../lib/nesting/gen-owl-rev-share-cover-shortfall-amount'

assert.equal(suggestedGenOwlRevShareCoverShortfallSol(0), 0)
assert.equal(suggestedGenOwlRevShareCoverShortfallSol(-1), 0)

const short = 0.45808
const suggested = suggestedGenOwlRevShareCoverShortfallSol(short)
assert.ok(suggested >= short + GEN_OWL_REV_SHARE_COVER_SHORTFALL_BUFFER_SOL - 1e-12)
assert.ok(suggested > short)

console.log('test-gen-owl-rev-share-cover-shortfall: ok', { short, suggested })
