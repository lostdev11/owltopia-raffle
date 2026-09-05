/**
 * Unit checks for Core mintLimit id/cap helpers.
 *
 * Run: npx --yes tsx scripts/test-core-mint-limit.ts
 */
import { none, some } from '@metaplex-foundation/umi'
import type { DefaultGuardSet } from '@metaplex-foundation/mpl-core-candy-machine'

import { coreGuardMintLimitCap, coreGuardMintLimitId } from '@/lib/solana/core-mint-limit'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  - ${name}`)
  else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

function guardsWithLimit(id: number, limit: number): DefaultGuardSet {
  return {
    mintLimit: some({ id, limit }),
  } as unknown as DefaultGuardSet
}

console.log('Core mintLimit helpers:')

check(
  'no mintLimit → null id',
  coreGuardMintLimitId({ mintLimit: none() } as unknown as DefaultGuardSet) === null
)
check('no mintLimit → null cap', coreGuardMintLimitCap({ mintLimit: none() } as unknown as DefaultGuardSet) === null)
check('mintLimit id', coreGuardMintLimitId(guardsWithLimit(1, 2)) === 1)
check('mintLimit cap', coreGuardMintLimitCap(guardsWithLimit(1, 2)) === 2)
check('undefined guards → null', coreGuardMintLimitId(undefined) === null)

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll core mint-limit helper checks passed.')
