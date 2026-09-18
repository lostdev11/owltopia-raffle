/**
 * Regression: partial multi-qty mint sessions surface a warning (requested > landed).
 *
 * Run: npx --yes tsx scripts/test-mint-session-outcome.ts
 */
import { resolveMintSessionOutcome } from '@/lib/owl-center/mint-session'
import type { MintGen2Result } from '@/lib/solana/gen2-mint'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  - ${name}`)
  else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

console.log('mint-session resolveMintSessionOutcome:')

{
  const minted: MintGen2Result = {
    ok: false,
    error: 'Minted 1/2',
    txSignatures: ['sig1'],
    mintedNftMints: ['Mint1111111111111111111111111111111111111111111'],
  }
  const out = resolveMintSessionOutcome(minted, 2)
  if ('error' in out) check('partial does not hard-fail', false)
  else {
    check('partial mintedCount=1', out.mintedCount === 1)
    check('partial warning mentions 1 of 2', out.warning?.includes('1 of 2') === true)
  }
}

{
  const minted: MintGen2Result = {
    ok: true,
    txSignatures: ['sig1', 'sig2'],
    mintedNftMints: ['a', 'b'],
  }
  const out = resolveMintSessionOutcome(minted, 2)
  if ('error' in out) check('full batch resolves', false)
  else {
    check('full batch count=2', out.mintedCount === 2)
    check('full batch no warning', out.warning == null)
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll mint-session outcome checks passed.')
