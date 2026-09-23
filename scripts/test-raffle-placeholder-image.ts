/**
 * Unit checks for raffle listing-image placeholder detection.
 * Run: npx tsx scripts/test-raffle-placeholder-image.ts
 */
import assert from 'node:assert/strict'
import { isLegacyOwltopiaPlaceholderImageUrl } from '../lib/raffle-display-image-url'

assert.equal(isLegacyOwltopiaPlaceholderImageUrl('/icon.png'), true)
assert.equal(isLegacyOwltopiaPlaceholderImageUrl('/logo.gif'), true)
assert.equal(isLegacyOwltopiaPlaceholderImageUrl(' /icon.png '), true)
assert.equal(
  isLegacyOwltopiaPlaceholderImageUrl('https://www.owltopia.xyz/icon.png'),
  true
)
assert.equal(
  isLegacyOwltopiaPlaceholderImageUrl('https://www.owltopia.xyz/logo.gif?v=1'),
  true
)
assert.equal(isLegacyOwltopiaPlaceholderImageUrl(null), false)
assert.equal(isLegacyOwltopiaPlaceholderImageUrl(''), false)
assert.equal(
  isLegacyOwltopiaPlaceholderImageUrl('https://arweave.net/uS-jYo7CF-du8BVru0g4Csrpd-OauzyI08NyUu7b7TA'),
  false
)
assert.equal(isLegacyOwltopiaPlaceholderImageUrl('/solana-mark.svg'), false)
assert.equal(isLegacyOwltopiaPlaceholderImageUrl('/trq-prize.svg'), false)

console.log('ok: raffle placeholder image helpers')
