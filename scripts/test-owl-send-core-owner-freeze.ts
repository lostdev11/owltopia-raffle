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

console.log('test-owl-send-core-owner-freeze: ok')
