/**
 * Unit tests for OwlSend Core Owner freeze error picking / detection.
 * Run: npx tsx scripts/test-owl-send-core-owner-freeze.ts
 */
import assert from 'node:assert/strict'
import {
  OWL_SEND_CORE_OWNER_FREEZE_ERROR,
  isOwlSendCoreOwnerFreezeError,
  isOwlSendMplCoreFreezeTransferError,
  pickOwlSendSpecialNftError,
} from '../lib/owl-send/mpl-core-owner-freeze'
import { owlSendLineShouldProbeCoreFreeze } from '../lib/owl-send/find-core-owner-frozen'
import { buildResumeSkippingFrozenPlan } from '../lib/owl-send/resume'
import { isOwlSendFrozenTransferError } from '../lib/owl-send/wallet-send-errors'
import { owlSendRetryHint } from '../lib/owl-send/retry-hint'

assert.equal(isOwlSendCoreOwnerFreezeError(OWL_SEND_CORE_OWNER_FREEZE_ERROR), true)
assert.equal(isOwlSendFrozenTransferError(OWL_SEND_CORE_OWNER_FREEZE_ERROR), true)
assert.ok(owlSendRetryHint(OWL_SEND_CORE_OWNER_FREEZE_ERROR).toLowerCase().includes('thaw'))

// Prefer Core freeze over Token Metadata Incorrect account owner noise (the screenshot bug).
const noisy = [
  'mpl_core: Asset is frozen',
  'compressed: something else',
  'token_metadata: Token Metadata transfer failed. ProgrammableNonFungible: Escrow deposit would fail on-chain before wallet approval. Incorrect account owner custom program error: 0x39',
]
const picked = pickOwlSendSpecialNftError(noisy)
assert.ok(picked)
assert.match(picked!, /frozen/i)
assert.doesNotMatch(picked!, /0x39/)

assert.equal(
  pickOwlSendSpecialNftError([
    OWL_SEND_CORE_OWNER_FREEZE_ERROR,
    'token_metadata: Incorrect account owner',
  ]),
  OWL_SEND_CORE_OWNER_FREEZE_ERROR
)

assert.equal(
  isOwlSendMplCoreFreezeTransferError('AssetAccountData EnumDiscriminatorOutOfRangeError'),
  false
)
assert.equal(isOwlSendMplCoreFreezeTransferError('FreezeDelegate still frozen'), true)

// Without a freeze signal, prefer the first (primary path) error — not the last fallback.
assert.equal(
  pickOwlSendSpecialNftError(['mpl_core: boom', 'token_metadata: Incorrect account owner']),
  'mpl_core: boom'
)

assert.equal(pickOwlSendSpecialNftError([]), null)

// Probe filter: skip compressed / pNFT; probe Core + unknown (send-special-nft parity).
assert.equal(owlSendLineShouldProbeCoreFreeze({ interface: 'MplCoreAsset' }), true)
assert.equal(owlSendLineShouldProbeCoreFreeze({ interface: 'V1_NFT' }), false)
assert.equal(
  owlSendLineShouldProbeCoreFreeze({ compressed: true, interface: 'V1_NFT' }),
  false
)
assert.equal(owlSendLineShouldProbeCoreFreeze({ interface: 'ProgrammableNFT' }), false)
assert.equal(owlSendLineShouldProbeCoreFreeze({ interface: null }), true)
assert.equal(owlSendLineShouldProbeCoreFreeze({}), true)

// Skip-frozen resume: Core Owner freeze failedMints must drop out of Retry plan
// (this is the screenshot bug — Skip frozen & retry used to replay the same poison mint).
const resume = buildResumeSkippingFrozenPlan({
  preparedLines: [
    { mint: 'frozenCore1', recipient: 'Recv111111111111111111111111111111111111111' },
    { mint: 'ok2', recipient: 'Recv111111111111111111111111111111111111111' },
    { mint: 'ok3', recipient: 'Recv111111111111111111111111111111111111111' },
  ],
  batches: [
    [{ mint: 'frozenCore1', recipient: 'Recv111111111111111111111111111111111111111' }],
    [{ mint: 'ok2', recipient: 'Recv111111111111111111111111111111111111111' }],
    [{ mint: 'ok3', recipient: 'Recv111111111111111111111111111111111111111' }],
  ],
  batchProgress: [
    { index: 0, status: 'failed' },
    { index: 1, status: 'pending' },
    { index: 2, status: 'pending' },
  ],
  frozenMints: ['frozenCore1'],
})
assert.equal(resume.ok, true)
if (resume.ok) {
  assert.equal(resume.skippedFrozen, 1)
  assert.deepEqual(
    resume.remaining.map((l) => l.mint),
    ['ok2', 'ok3']
  )
  assert.ok(!resume.remaining.some((l) => l.mint === 'frozenCore1'))
}

console.log('test-owl-send-core-owner-freeze: ok')
