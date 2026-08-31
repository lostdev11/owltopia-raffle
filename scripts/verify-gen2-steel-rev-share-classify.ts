/**
 * Verify VaultTecSe7en / Steel Gen 2 1/1 classification + expected rev-share amount.
 * Read-only mainnet DAS via public Solana RPC (no Helius key required for allowlist path).
 *
 * Run: npx tsx scripts/verify-gen2-steel-rev-share-classify.ts
 */
import assert from 'node:assert/strict'
import { computeGenOwlRevShareBucketAmounts } from '../lib/nesting/gen-owl-rev-share'
import {
  classifyGen2OneOfOneMints,
  isGen2OneOfOneFromDasAsset,
  mintIsGen2OneOfOneAllowlisted,
} from '../lib/nesting/gen2-one-of-one'
import { GEN2_STEEL_ONE_OF_ONE_MINT } from '../lib/nesting/gen2-one-of-one-mints'

const WALLET = 'GLPGo5WFKEDGw37FMVR82k9EFNLuUYaAnQdSQhHUq7hC'
const STEEL = GEN2_STEEL_ONE_OF_ONE_MINT
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() || 'https://api.mainnet-beta.solana.com'

async function main() {
  assert.equal(mintIsGen2OneOfOneAllowlisted(STEEL), true, 'Steel must be allowlisted')

  const classified = await classifyGen2OneOfOneMints([STEEL])
  assert.equal(classified.get(STEEL), 'one-of-one', 'classifyGen2OneOfOneMints(Steel)')

  const dasRes = await fetch(RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAsset',
      params: { id: STEEL },
    }),
  })
  const dasJson = (await dasRes.json()) as { result?: unknown }
  const payload = dasJson.result
  const name =
    payload && typeof payload === 'object'
      ? ((payload as { content?: { metadata?: { name?: string } } }).content?.metadata?.name ??
        null)
      : null
  assert.equal(isGen2OneOfOneFromDasAsset(STEEL, payload), true, 'DAS+allowlist for Steel')

  const buckets = computeGenOwlRevShareBucketAmounts({
    totalSol: 7,
    totalUsdc: null,
    standardCount: 1397 - 14,
    oneOfOneCount: 14,
  })
  const standard = buckets.standard_per_nest_sol ?? 0
  const oneOfOne = buckets.one_of_one_per_nest_sol ?? 0

  const lines = [
    `Wallet: ${WALLET}`,
    `Steel mint: ${STEEL}`,
    `DAS name: ${name ?? '(unknown)'}`,
    `Allowlisted: true`,
    `classifyGen2OneOfOneMints → ${classified.get(STEEL)}`,
    '',
    'BEFORE (misclassified as standard):',
    `  ${standard.toFixed(9)} SOL  (Gen 2 · 1 nest)`,
    '',
    'AFTER (classified as Gen 2 1/1):',
    `  ${oneOfOne.toFixed(9)} SOL  (Gen 2 1/1 · 1 nest)`,
    '',
    `Delta: +${(oneOfOne - standard).toFixed(9)} SOL`,
  ]

  console.log(lines.join('\n'))
  assert.ok(Math.abs(standard - 0.004509664) < 1e-9, `standard rate got ${standard}`)
  assert.ok(Math.abs(oneOfOne - 0.054509664) < 1e-9, `1/1 rate got ${oneOfOne}`)
  console.log('\nverify-gen2-steel-rev-share-classify: ok')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
