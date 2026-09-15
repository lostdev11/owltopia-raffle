/**
 * Unit checks for Candy Machine rent audit formatting (no RPC).
 */
import assert from 'node:assert/strict'

import { dedupeCmCandidates, formatCmGuardRentRow } from '@/lib/solana/owl-center-cm-rent-audit'

const sample = formatCmGuardRentRow({
  address: 'CndyV3Example1111111111111111111111111111111',
  accountKind: 'classic_candy_machine',
  ownerProgram: 'CndyV3LdqHUfDLmE5naZjVN8rBZz4tqhdefbAnjHG3JR',
  balanceLamports: 2_100_000_000n,
  minRentLamports: 1_500_000_000n,
  excessLamports: 600_000_000n,
  mintStatusHint: 'minting (158 remaining · 842/1000 minted)',
  launchSlug: 'gen2',
  candyMachineId: 'CndyV3Example1111111111111111111111111111111',
})

assert.match(sample, /slug=gen2/)
assert.match(sample, /classic_candy_machine/)
assert.match(sample, /excess=0\.600000/)
assert.match(sample, /842\/1000/)

const deduped = dedupeCmCandidates([
  { candyMachineId: 'A', network: 'mainnet' },
  { candyMachineId: 'A', network: 'mainnet', launchSlug: 'dup' },
  { candyMachineId: 'A', network: 'devnet' },
])
assert.equal(deduped.length, 2)

console.log('test-owl-center-cm-rent-audit: ok')
console.log('sample row:')
console.log(`  ${sample}`)
