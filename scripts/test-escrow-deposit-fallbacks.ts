/**
 * Unit tests for escrow deposit fallback ordering and Core wrong-account error sanitization.
 * Run: npx tsx scripts/test-escrow-deposit-fallbacks.ts
 */
import assert from 'node:assert/strict'
import {
  isDasCompressedNft,
  isDasMplCoreInterface,
  isDasTokenMetadataInterface,
  orderedEscrowFallbacks,
  prizeStandardFromWalletNft,
} from '../lib/solana/prize-nft-standard'
import {
  isMplCoreWrongAccountTypeError,
  sanitizeEscrowTransferFallbackError,
} from '../lib/solana/mpl-core-transfer-errors'

assert.equal(isDasMplCoreInterface('MplCoreAsset'), true)
assert.equal(isDasMplCoreInterface('V1_NFT'), false)
assert.equal(isDasCompressedNft({ compressed: true }), true)
assert.equal(isDasCompressedNft({ interface: 'V1_NFT_COMPRESSED' }), true)
assert.equal(isDasTokenMetadataInterface('ProgrammableNFT'), true)
assert.equal(isDasTokenMetadataInterface('MplCoreAsset'), false)

assert.deepEqual(orderedEscrowFallbacks({}), [
  'token_metadata',
  'compressed',
  'mpl_core',
])
assert.deepEqual(orderedEscrowFallbacks({ interface: 'V1_NFT' }), [
  'token_metadata',
  'compressed',
  'mpl_core',
])
assert.deepEqual(orderedEscrowFallbacks({ interface: 'ProgrammableNFT' }), [
  'token_metadata',
  'compressed',
  'mpl_core',
])
assert.deepEqual(orderedEscrowFallbacks({ interface: 'MplCoreAsset' }), [
  'mpl_core',
  'compressed',
  'token_metadata',
])
assert.deepEqual(orderedEscrowFallbacks({ compressed: true }), [
  'compressed',
  'token_metadata',
  'mpl_core',
])
assert.deepEqual(orderedEscrowFallbacks({ skipTokenMetadata: true }), [
  'compressed',
  'mpl_core',
])

assert.equal(prizeStandardFromWalletNft({ interface: 'MplCoreAsset' }), 'mpl_core')
assert.equal(prizeStandardFromWalletNft({ compressed: true }), 'compressed')
assert.equal(prizeStandardFromWalletNft({ interface: 'V1_NFT' }), 'spl')
assert.equal(prizeStandardFromWalletNft({}), null)

const sdkNoise = `The account at the provided address
[8hMdeQsDzT9sgRfntfnaEUt5HbARy2QeJK8rl…]
is not of the expected type [AssetAccountData].
Source: SDK
Caused By:
EnumDiscriminatorOutOfRangeError:
Enum discriminator out of range.
Expected a number between 0 and 2, got 129.`

assert.equal(isMplCoreWrongAccountTypeError(sdkNoise), true)
const sanitized = sanitizeEscrowTransferFallbackError(sdkNoise)
assert.ok(sanitized.includes('not a Metaplex Core asset'))
assert.ok(!sanitized.includes('EnumDiscriminatorOutOfRangeError'))
assert.ok(!sanitized.includes('got 129'))

console.log('test-escrow-deposit-fallbacks: ok')
