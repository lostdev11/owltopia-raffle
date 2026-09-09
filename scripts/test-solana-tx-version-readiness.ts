/**
 * Guardrail: every RPC transaction fetch must opt into Solana v1 decode
 * (SIMD-0385 / larger transaction sizes) via MAX_SUPPORTED_TRANSACTION_VERSION.
 *
 * Run: npx --yes tsx scripts/test-solana-tx-version-readiness.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { clampMaxSupportedTransactionVersion } from '@/lib/solana/rpc-version-clamp'
import {
  MAX_SUPPORTED_TRANSACTION_VERSION,
  RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
} from '@/lib/solana/transaction-version'
import {
  assertSolanaTxV1BatchExploitStillGated,
  getSolanaTxV1BatchPrerequisites,
  SOLANA_TX_V1_BATCH_EXPLOIT_ENABLED,
} from '@/lib/solana/tx-v1-batch-opportunity'
import {
  SOLANA_TX_V1_VENDOR_WATCHLIST,
  summarizeSolanaTxV1VendorWatch,
} from '@/lib/solana/tx-v1-vendor-watch'

assert.equal(MAX_SUPPORTED_TRANSACTION_VERSION, 1)
assert.equal(RPC_MAX_SUPPORTED_TRANSACTION_VERSION.maxSupportedTransactionVersion, 1)
assert.equal(SOLANA_TX_V1_BATCH_EXPLOIT_ENABLED, false)
assertSolanaTxV1BatchExploitStillGated()
assert.ok(getSolanaTxV1BatchPrerequisites().every((p) => p.ready === false))
assert.ok(SOLANA_TX_V1_VENDOR_WATCHLIST.length >= 3)
assert.ok(summarizeSolanaTxV1VendorWatch().includes('umi-rpc-web3js'))

// RPC proxy clamp: under-requests become ceiling 1; unrelated methods untouched.
{
  const bumped = clampMaxSupportedTransactionVersion({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransaction',
    params: ['Sig111', { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }],
  }) as { params: [{}, { maxSupportedTransactionVersion: number }] }
  assert.equal(bumped.params[1].maxSupportedTransactionVersion, 1)

  const omitted = clampMaxSupportedTransactionVersion({
    jsonrpc: '2.0',
    id: 2,
    method: 'getBlock',
    params: [123],
  }) as { params: [number, { maxSupportedTransactionVersion: number }] }
  assert.equal(omitted.params[1].maxSupportedTransactionVersion, 1)

  const balance = clampMaxSupportedTransactionVersion({
    jsonrpc: '2.0',
    id: 3,
    method: 'getBalance',
    params: ['Wallet111'],
  }) as { method: string; params: string[] }
  assert.equal(balance.method, 'getBalance')
  assert.deepEqual(balance.params, ['Wallet111'])
}

const ROOT = join(process.cwd())
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage', 'governance-anchor'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) out.push(p)
  }
  return out
}

const offenders: string[] = []
for (const file of walk(ROOT)) {
  if (file.endsWith('scripts/test-solana-tx-version-readiness.ts')) continue
  if (file.endsWith('scripts/test-solana-v1-devnet-read.ts')) continue
  if (file.includes(`${join('lib', 'solana', 'rpc-version-clamp')}`)) continue
  const text = readFileSync(file, 'utf8')
  if (/maxSupportedTransactionVersion:\s*0\b/.test(text)) {
    offenders.push(`${file}: still hard-codes maxSupportedTransactionVersion: 0`)
  }
  if (/maxSupportedTransactionVersion:\s*'legacy'/.test(text)) {
    offenders.push(`${file}: still uses maxSupportedTransactionVersion: 'legacy'`)
  }
  // Flag getTransaction/getParsedTransaction option objects that omit the version field entirely.
  // Narrow heuristic: `{ commitment: 'confirmed' }` / `{ commitment: 'finalized' }` alone as 2nd arg.
  if (
    /get(?:Parsed)?Transaction\([^)]*\{\s*commitment:\s*'(?:confirmed|finalized)'\s*\}/.test(text)
  ) {
    offenders.push(`${file}: getTransaction/getParsedTransaction omits maxSupportedTransactionVersion`)
  }
}

assert.equal(
  offenders.length,
  0,
  `Found stale transaction version opts:\n${offenders.join('\n')}`
)

console.log(
  `solana-tx-version-readiness: ok (MAX_SUPPORTED_TRANSACTION_VERSION=1, RPC clamp, batch exploit gated, vendors=${summarizeSolanaTxV1VendorWatch()})`
)
