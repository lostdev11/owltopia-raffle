/**
 * Unit tests for OwlSwap Trading Room UI state helpers.
 * Run: npm run test:owl-swap-trading-room-ui-state
 */
import assert from 'node:assert/strict'
import {
  canShowCompletedTradeVisuals,
  deriveTradingRoomTxUiState,
  formatNftCountBadge,
  formatTradeSummaryLine,
  isInFlightTxUiState,
  nextReviewEpoch,
  selectionFingerprint,
  shouldEnablePrimaryCta,
  tradingRoomStatusBannerCopy,
} from '@/lib/owl-swap/trading-room-ui-state'

assert.equal(canShowCompletedTradeVisuals({ offerStatus: 'completed', settleSig: 'abc' }), true)
assert.equal(canShowCompletedTradeVisuals({ offerStatus: 'completed', settleSig: null }), false)
assert.equal(canShowCompletedTradeVisuals({ offerStatus: 'open', settleSig: 'abc' }), false)

assert.equal(
  deriveTradingRoomTxUiState({
    offerStatus: 'completed',
    settleSig: 'sig',
    localPhase: 'idle',
  }),
  'completed'
)

assert.equal(
  deriveTradingRoomTxUiState({
    offerStatus: 'open',
    makerDepositSig: 'dep',
    mode: 'create',
    localPhase: 'idle',
  }),
  'open_shared'
)

assert.equal(
  deriveTradingRoomTxUiState({
    offerStatus: 'open',
    localPhase: 'awaiting_signature',
    mode: 'accept',
  }),
  'awaiting_signature'
)

assert.equal(
  deriveTradingRoomTxUiState({
    offerStatus: 'open',
    localPhase: 'rejected',
  }),
  'rejected'
)

assert.equal(
  deriveTradingRoomTxUiState({
    offerStatus: 'expired',
    localPhase: 'idle',
  }),
  'expired'
)

// Pending confirmation must not look like completed
assert.notEqual(
  deriveTradingRoomTxUiState({
    offerStatus: 'open',
    localPhase: 'pending_confirmation',
  }),
  'completed'
)

assert.equal(isInFlightTxUiState('awaiting_signature'), true)
assert.equal(isInFlightTxUiState('idle_review'), false)

assert.equal(formatNftCountBadge(0), '0 NFT')
assert.equal(formatNftCountBadge(1), '1 NFT')
assert.equal(formatNftCountBadge(3), '3 NFTs')

assert.equal(
  formatTradeSummaryLine({ offerCount: 1, receiveCount: 1 }),
  '1 NFT for 1 NFT'
)
assert.equal(
  formatTradeSummaryLine({ offerCount: 2, receiveCount: 0 }),
  '2 NFTs for counterparty'
)

assert.equal(nextReviewEpoch(0), 1)
assert.equal(
  selectionFingerprint([{ mint: 'b' }, { mint: 'a' }], 100),
  'a,b|100'
)

assert.equal(
  shouldEnablePrimaryCta({
    txState: 'idle_review',
    offerSideReady: true,
    escrowReady: true,
    feeQuoteReady: true,
  }),
  true
)
assert.equal(
  shouldEnablePrimaryCta({
    txState: 'idle_review',
    offerSideReady: true,
    escrowReady: false,
    feeQuoteReady: true,
  }),
  false
)
assert.equal(
  shouldEnablePrimaryCta({
    txState: 'submitting',
    offerSideReady: true,
    escrowReady: true,
    feeQuoteReady: true,
  }),
  false
)

assert.equal(tradingRoomStatusBannerCopy('completed').tone, 'success')
assert.equal(tradingRoomStatusBannerCopy('failed').tone, 'error')
assert.notEqual(tradingRoomStatusBannerCopy('pending_confirmation').tone, 'success')

console.log('ok — owl-swap trading-room-ui-state')
