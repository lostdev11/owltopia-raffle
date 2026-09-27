import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { PackOpenRetryableError, isPackOpenRetryableError } from '../lib/packs/pack-open-errors'
import {
  isPackPayoutTransientError,
  isPackVaultPayoutResultRetryable,
} from '../lib/packs/payout-transient'
import {
  PACK_NFT_PAYOUT_FAIL_QUARANTINE_THRESHOLD,
  shouldQuarantinePackInventoryAfterPayoutFailure,
} from '../lib/packs/nft-quarantine-policy'
import { isTransientSolanaRpcError } from '../lib/solana/rpc-retry'

function readRepoFile(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8')
}

// --- Transient vs refund ---

assert.equal(isPackPayoutTransientError(new Error('429 Too Many Requests')), true)
assert.equal(isPackPayoutTransientError(new Error('Simulation failed: owner not allowed')), false)

const uncertain = isPackVaultPayoutResultRetryable({
  ok: false,
  confirmUncertain: true,
  error: 'timeout',
})
assert.equal(uncertain, true)

const simFail = isPackVaultPayoutResultRetryable({
  ok: false,
  error: 'Simulation failed: Provided owner is not allowed',
})
assert.equal(simFail, false)

const retryableErr = new PackOpenRetryableError('rpc')
assert.equal(isPackOpenRetryableError(retryableErr), true)
assert.equal(isTransientSolanaRpcError(new Error('block height exceeded')), false)
assert.equal(isPackPayoutTransientError(new Error('block height exceeded')), true)

// --- Quarantine threshold ---

assert.equal(PACK_NFT_PAYOUT_FAIL_QUARANTINE_THRESHOLD, 2)
assert.equal(shouldQuarantinePackInventoryAfterPayoutFailure(1), false)
assert.equal(shouldQuarantinePackInventoryAfterPayoutFailure(2), true)

// --- Idempotent ATA in vault + client checkout ---

const vaultSrc = readRepoFile('lib/packs/vault.ts')
assert.ok(
  vaultSrc.includes('createAssociatedTokenAccountIdempotentInstruction'),
  'vault must use idempotent ATA create'
)
assert.ok(!vaultSrc.includes('createAssociatedTokenAccountInstruction('), 'vault must not use non-idempotent ATA')

const clientSrc = readRepoFile('lib/client/execute-pack-purchase.ts')
assert.ok(clientSrc.includes('createAssociatedTokenAccountIdempotentInstruction'))

// --- Compressed payout avoids merkle tree fetch ---

const cnftPayout = readRepoFile('lib/solana/payout-nft-from-keypair.ts')
assert.ok(cnftPayout.includes('truncateCanopy: false'))
assert.ok(!cnftPayout.includes('truncateCanopy: true'))

// --- open-payout: throws become retryable, not silent refund ---

const openPayoutSrc = readRepoFile('lib/packs/open-payout.ts')
assert.ok(openPayoutSrc.includes('PackOpenRetryableError'))
assert.ok(openPayoutSrc.includes('isPackPayoutTransientError'))
assert.ok(openPayoutSrc.includes('releaseOrQuarantineNftAfterPayoutFailure'))
assert.ok(openPayoutSrc.includes('onSent'))

// --- Reconcile: payment signature reuse guard (pure) ---

function paymentSigClaimedByOther(
  rows: { id: string }[],
  openId: string
): boolean {
  return rows.some((r) => r.id !== openId)
}

assert.equal(
  paymentSigClaimedByOther([{ id: 'a' }, { id: 'b' }], 'a'),
  true
)
assert.equal(paymentSigClaimedByOther([{ id: 'a' }], 'a'), false)

// --- OWL landed check requires payout sig (no balance-only heuristic) ---

const payoutVerify = readRepoFile('lib/packs/payout-verify.ts')
assert.ok(payoutVerify.includes('recipientReceivedOwlFromPayoutSignature'))
assert.ok(!payoutVerify.includes('recipientReceivedOwl('))

console.log(JSON.stringify({ ok: true, tests: 'packs-open-payout-resilience' }))
