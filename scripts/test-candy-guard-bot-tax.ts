/**
 * Unit checks for Candy Guard bot-tax log detection (Breppe AllowedMintLimitReached ticket).
 *
 * Run: npx --yes tsx scripts/test-candy-guard-bot-tax.ts
 */
import { candyGuardSimulationLooksLikeBotTax } from '@/lib/solana/candy-guard-bot-tax'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  - ${name}`)
  else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

console.log('Candy Guard bot-tax log detection:')

check('empty logs are clean', candyGuardSimulationLooksLikeBotTax([]) === null)
check('null logs are clean', candyGuardSimulationLooksLikeBotTax(null) === null)

{
  const reason = candyGuardSimulationLooksLikeBotTax([
    'Program log: Instruction: MintV1',
    'Program log: AnchorError { error_name: "AllowedMintLimitReached", error_code_number: 6029 }',
    'Program log: Candy Guard Botting is taxed at 1000000 lamports',
  ])
  check('AllowedMintLimitReached is bot-tax', reason != null)
  check('AllowedMintLimitReached mentions wallet limit', Boolean(reason?.includes('limit')))
}

{
  const reason = candyGuardSimulationLooksLikeBotTax([
    'Program log: Instruction: MintV1',
    'Program log: Candy Guard Botting is taxed at 1000000 lamports',
  ])
  check('generic bot-tax marker is caught', reason != null)
}

{
  const reason = candyGuardSimulationLooksLikeBotTax([
    'Program log: Instruction: MintV1',
    'Program log: Instruction: MintAsset',
    'Program log: Instruction: Create',
  ])
  check('successful mint logs are clean', reason === null)
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`)
  process.exit(1)
}
console.log('\nAll candy-guard bot-tax checks passed.')
