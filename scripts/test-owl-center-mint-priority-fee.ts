/**
 * Run: npx tsx scripts/test-owl-center-mint-priority-fee.ts
 */
import assert from 'node:assert/strict'
import { owlCenterMintPriorityFeeMicroLamports } from '../lib/solana/owl-center-mint-priority-fee'

const prevOwl = process.env.NEXT_PUBLIC_OWL_CENTER_MINT_PRIORITY_FEE_MICROLAMPORTS
const prevGen2 = process.env.NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS

try {
  delete process.env.NEXT_PUBLIC_OWL_CENTER_MINT_PRIORITY_FEE_MICROLAMPORTS
  delete process.env.NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS
  assert.equal(owlCenterMintPriorityFeeMicroLamports(), 400_000, 'default')

  process.env.NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS = '123000'
  assert.equal(owlCenterMintPriorityFeeMicroLamports(), 123_000, 'legacy Gen2 env fallback')

  process.env.NEXT_PUBLIC_OWL_CENTER_MINT_PRIORITY_FEE_MICROLAMPORTS = '555000'
  assert.equal(owlCenterMintPriorityFeeMicroLamports(), 555_000, 'Owl Center env wins')

  process.env.NEXT_PUBLIC_OWL_CENTER_MINT_PRIORITY_FEE_MICROLAMPORTS = '0'
  assert.equal(owlCenterMintPriorityFeeMicroLamports(), 0, 'zero disables')
} finally {
  if (prevOwl === undefined) delete process.env.NEXT_PUBLIC_OWL_CENTER_MINT_PRIORITY_FEE_MICROLAMPORTS
  else process.env.NEXT_PUBLIC_OWL_CENTER_MINT_PRIORITY_FEE_MICROLAMPORTS = prevOwl
  if (prevGen2 === undefined) delete process.env.NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS
  else process.env.NEXT_PUBLIC_GEN2_MINT_PRIORITY_FEE_MICROLAMPORTS = prevGen2
}

console.log('ok — owl-center mint priority fee env')
