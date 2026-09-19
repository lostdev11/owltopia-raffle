/**
 * Unit checks for post-mint confirm eligibility + recovered-mint confirm terminal outcomes.
 *
 * Run: npx --yes tsx scripts/test-confirm-mint-eligibility.ts
 */
import { canConfirmVerifiedMintQuantity } from '@/lib/owl-center/confirm-mint-eligibility'
import {
  isHardMintConfirmFailure,
  runRecoveredMintConfirm,
} from '@/lib/owl-center/mint-finalize-client'

let failures = 0
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ok  - ${name}`)
  else {
    failures++
    console.error(`  FAIL - ${name}`)
  }
}

console.log('canConfirmVerifiedMintQuantity (post-mint gate):')

{
  // After minting the last of 2 WL spots, on-chain counter → max_mintable=0, wallet_minted=2.
  const r = canConfirmVerifiedMintQuantity({
    quantity: 1,
    maxMintable: 0,
    isPaused: false,
    walletMinted: 2,
    walletMintLimit: 2,
  })
  check('allows confirm when last spot just filled (max_mintable=0)', r.ok === true)
}

{
  const r = canConfirmVerifiedMintQuantity({
    quantity: 1,
    maxMintable: 0,
    isPaused: false,
    walletMinted: 1,
    walletMintLimit: 1,
  })
  check('allows confirm when single-spot wallet just minted', r.ok === true)
}

{
  const r = canConfirmVerifiedMintQuantity({
    quantity: 2,
    maxMintable: 0,
    isPaused: false,
    walletMinted: 2,
    walletMintLimit: 2,
  })
  check('allows multi-qty confirm that filled the wallet limit', r.ok === true)
}

{
  const r = canConfirmVerifiedMintQuantity({
    quantity: 1,
    maxMintable: 3,
    isPaused: false,
    walletMinted: 2,
    walletMintLimit: 5,
  })
  check('allows confirm with remaining spots', r.ok === true)
}

{
  const r = canConfirmVerifiedMintQuantity({
    quantity: 1,
    maxMintable: 0,
    isPaused: true,
    walletMinted: 1,
    walletMintLimit: 2,
  })
  check('rejects when mint is paused', r.ok === false && !r.ok && r.error.includes('paused'))
}

{
  const r = canConfirmVerifiedMintQuantity({
    quantity: 1,
    maxMintable: 0,
    walletMinted: 3,
    walletMintLimit: 2,
  })
  check('rejects when post-mint count exceeds wallet limit', r.ok === false)
}

{
  const r = canConfirmVerifiedMintQuantity({
    quantity: 0,
    maxMintable: 2,
  })
  check('rejects invalid quantity', r.ok === false)
}

{
  // Gen2 path: no wallet counters — credit qty onto max_mintable.
  const r = canConfirmVerifiedMintQuantity({
    quantity: 1,
    maxMintable: 0,
    isPaused: false,
  })
  check('Gen2: allows when max_mintable already 0 after mint', r.ok === true)
}

console.log('\nisHardMintConfirmFailure:')
check('matches no-nft copy', isHardMintConfirmFailure('No NFT was minted in this transaction'))
check('ignores soft eligibility errors', !isHardMintConfirmFailure('Not eligible for this mint quantity'))

console.log('\nrunRecoveredMintConfirm (terminal outcomes):')

async function runRecoveryChecks() {
  {
    const result = await runRecoveredMintConfirm({
      sigs: ['Sig111111111111111111111111111111111111111111111111111111111111111'],
      mintPks: ['Mint1111111111111111111111111111111111111111111'],
      confirmBatch: async () => {
        throw new Error('Not eligible for this mint quantity — refresh your allocation')
      },
    })
    check(
      'soft confirm failure with mint pks → success (no hang)',
      result.kind === 'success' && result.count === 1
    )
  }

  {
    const result = await runRecoveredMintConfirm({
      sigs: ['Sig111111111111111111111111111111111111111111111111111111111111111'],
      mintPks: [],
      confirmBatch: async () => {
        throw new Error('Saving mint timed out')
      },
    })
    check('timeout with no mint pks → error terminal', result.kind === 'error')
  }

  {
    const result = await runRecoveredMintConfirm({
      sigs: ['Sig111111111111111111111111111111111111111111111111111111111111111'],
      mintPks: ['Mint1111111111111111111111111111111111111111111'],
      confirmBatch: async () => {
        throw new Error('No NFT was minted in this transaction — the mint did not go through')
      },
    })
    check(
      'hard confirm failure → error terminal',
      result.kind === 'error' && result.hardFailure === true
    )
  }

  {
    const result = await runRecoveredMintConfirm({
      sigs: ['Sig111111111111111111111111111111111111111111111111111111111111111'],
      mintPks: ['Mint1111111111111111111111111111111111111111111'],
      confirmBatch: async () => {},
    })
    check('happy confirm → success', result.kind === 'success' && result.count === 1)
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`)
    process.exit(1)
  }
  console.log('\nAll checks passed.')
}

void runRecoveryChecks()
