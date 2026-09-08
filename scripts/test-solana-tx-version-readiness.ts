/**
 * Guardrail: every RPC transaction fetch must opt into Solana v1 decode
 * (SIMD-0385 / larger transaction sizes) via MAX_SUPPORTED_TRANSACTION_VERSION.
 *
 * Run: npx --yes tsx scripts/test-solana-tx-version-readiness.ts
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  MAX_SUPPORTED_TRANSACTION_VERSION,
  RPC_MAX_SUPPORTED_TRANSACTION_VERSION,
} from '@/lib/solana/transaction-version'

assert.equal(MAX_SUPPORTED_TRANSACTION_VERSION, 1)
assert.equal(RPC_MAX_SUPPORTED_TRANSACTION_VERSION.maxSupportedTransactionVersion, 1)

const ROOT = join(process.cwd())
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'coverage', 'governance-anchor'])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

const offenders: string[] = []
for (const file of walk(ROOT)) {
  if (file.endsWith('scripts/test-solana-tx-version-readiness.ts')) continue
  const text = readFileSync(file, 'utf8')
  if (/maxSupportedTransactionVersion:\s*0\b/.test(text)) {
    offenders.push(`${file}: still hard-codes maxSupportedTransactionVersion: 0`)
  }
  if (/maxSupportedTransactionVersion:\s*'legacy'/.test(text)) {
    offenders.push(`${file}: still uses maxSupportedTransactionVersion: 'legacy'`)
  }
}

assert.equal(
  offenders.length,
  0,
  `Found stale transaction version opts:\n${offenders.join('\n')}`
)

console.log('solana-tx-version-readiness: ok (MAX_SUPPORTED_TRANSACTION_VERSION=1, no stale 0/legacy opts)')
