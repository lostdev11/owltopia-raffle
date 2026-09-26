/**
 * Unit tests for automatic pack shelf pause reconciliation.
 * Run: npm run test:packs-shelf-reconcile
 */
import assert from 'node:assert/strict'
import { packPauseReasonLabel } from '@/lib/packs/admin-copy'
import {
  isAutomaticShelfPauseReason,
  shouldClearAutomaticShelfPause,
} from '@/lib/packs/shelf-pause-logic'

assert.equal(isAutomaticShelfPauseReason('Low NFT inventory on this shelf (0 < min 1)'), true)
assert.equal(
  isAutomaticShelfPauseReason('Low NFT inventory (2 < min 5)'),
  true
)
assert.equal(
  isAutomaticShelfPauseReason('NFT inventory empty during open — shelf paused'),
  true
)
assert.equal(isAutomaticShelfPauseReason('Paused by admin'), false)
assert.equal(isAutomaticShelfPauseReason('Manual ops hold'), false)

assert.equal(
  shouldClearAutomaticShelfPause({
    shelfPaused: true,
    shelfPauseReason: 'Low NFT inventory on this shelf (0 < min 1)',
    nftCount: 14,
    minNft: 1,
  }),
  true
)

assert.equal(
  shouldClearAutomaticShelfPause({
    shelfPaused: true,
    shelfPauseReason: 'NFT inventory empty during open — shelf paused',
    nftCount: 3,
    minNft: 1,
  }),
  true
)

assert.equal(
  shouldClearAutomaticShelfPause({
    shelfPaused: true,
    shelfPauseReason: 'Paused by admin',
    nftCount: 99,
    minNft: 1,
  }),
  false
)

assert.equal(
  shouldClearAutomaticShelfPause({
    shelfPaused: true,
    shelfPauseReason: 'Low NFT inventory on this shelf (0 < min 5)',
    nftCount: 2,
    minNft: 5,
  }),
  false
)

assert.equal(
  shouldClearAutomaticShelfPause({
    shelfPaused: false,
    shelfPauseReason: 'Low NFT inventory on this shelf (0 < min 1)',
    nftCount: 10,
    minNft: 1,
  }),
  false
)

const labeled = packPauseReasonLabel('Low NFT inventory on this shelf (0 < min 1)')
assert.match(labeled ?? '', /Not enough prize NFTs \(0, need at least 1\)/)

console.log('test-packs-shelf-reconcile: ok')
