/**
 * Unit checks: Gen 1 + Gen 2 both qualify for the raffle 3% holder fee collection list.
 * Run: npx --yes tsx scripts/test-gen2-holder-fee-collections.ts
 */
import assert from 'node:assert/strict'
import {
  getOwltopiaHolderFeeCollectionAddresses,
  resolveGen2HolderFeeCollectionAddress,
} from '../lib/config/raffles'
import { OWLTOPIA_GEN2_COLLECTION_MINT } from '../lib/owltopia-marketplace-links'

const prevGen2 = process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT

try {
  delete process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT
  assert.equal(resolveGen2HolderFeeCollectionAddress(), OWLTOPIA_GEN2_COLLECTION_MINT)

  const addrs = getOwltopiaHolderFeeCollectionAddresses()
  assert.ok(
    addrs.includes(OWLTOPIA_GEN2_COLLECTION_MINT),
    'Gen 2 production mint must be in holder fee collections'
  )
  assert.equal(
    addrs.filter((a) => a === OWLTOPIA_GEN2_COLLECTION_MINT).length,
    1,
    'Gen 2 mint must appear once'
  )

  const envMint = 'Gen2EnvCollection111111111111111111111111111'
  process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT = envMint
  assert.equal(resolveGen2HolderFeeCollectionAddress(), envMint)
  const withEnv = getOwltopiaHolderFeeCollectionAddresses()
  assert.ok(withEnv.includes(envMint), 'env Gen 2 mint must be included')
  assert.equal(
    withEnv.includes(OWLTOPIA_GEN2_COLLECTION_MINT),
    false,
    'env Gen 2 mint should replace hardcoded production mint'
  )

  console.log('test-gen2-holder-fee-collections: ok')
} finally {
  if (prevGen2 === undefined) delete process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT
  else process.env.NEXT_PUBLIC_GEN2_COLLECTION_MINT = prevGen2
}
