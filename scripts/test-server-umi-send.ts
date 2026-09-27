/**
 * Unit checks for server UMI send confirmation (raw signature bytes vs base58).
 * Run: npx --yes tsx --test scripts/test-server-umi-send.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import bs58 from 'bs58'
import {
  sendAndConfirmUmiWithRetry,
  signatureSucceededOnChain,
} from '../lib/solana/umi-send-with-retry'
import type { Transaction, TransactionBuilder, Umi } from '@metaplex-foundation/umi'

function fakeSignatureBytes(): Uint8Array {
  const bytes = new Uint8Array(64)
  bytes.fill(7)
  return bytes
}

describe('signatureSucceededOnChain', () => {
  it('detects confirmed status when Umi receives raw signature bytes', async () => {
    const sig = fakeSignatureBytes()
    let getStatusesCalls = 0
    const umi = {
      rpc: {
        getSignatureStatuses: async (sigs: Uint8Array[]) => {
          getStatusesCalls += 1
          assert.equal(sigs.length, 1)
          assert.deepEqual(sigs[0], sig)
          return [{ commitment: 'confirmed', error: null }]
        },
        getTransaction: async () => {
          throw new Error('getTransaction should not run when status is confirmed')
        },
      },
    } as unknown as Umi

    const ok = await signatureSucceededOnChain(umi, sig as never)
    assert.equal(ok, true)
    assert.equal(getStatusesCalls, 1)
  })

  it('returns false when RPC rejects signature lookup (no false confirm)', async () => {
    const sig = fakeSignatureBytes()
    const umi = {
      rpc: {
        getSignatureStatuses: async () => {
          throw new Error('Invalid base58 string (deserialization)')
        },
        getTransaction: async () => null,
      },
    } as unknown as Umi

    const ok = await signatureSucceededOnChain(umi, sig as never)
    assert.equal(ok, false)
  })
})

describe('sendAndConfirmUmiWithRetry confirm loop', () => {
  it('confirms on first poll without resending the transaction', async () => {
    const sig = fakeSignatureBytes()
    let sendCount = 0
    let statusPolls = 0

    const signedTx = { signatures: [sig] } as unknown as Transaction

    const builder = {
      setBlockhash: () => builder,
      buildAndSign: async () => signedTx,
    } as unknown as TransactionBuilder

    const umi = {
      rpc: {
        getEndpoint: () => 'http://127.0.0.1:8899',
        getLatestBlockhash: async () => ({
          blockhash: 'Bh',
          lastValidBlockHeight: 999_999_999,
        }),
        sendTransaction: async () => {
          sendCount += 1
        },
        getSignatureStatuses: async () => {
          statusPolls += 1
          return [{ commitment: 'confirmed', error: null }]
        },
        getTransaction: async () => null,
      },
    } as unknown as Umi

    const { signature } = await sendAndConfirmUmiWithRetry(umi, builder, {
      label: 'test_tx',
      resendIntervalMs: 500,
      priorityMicroLamports: 0,
    })
    assert.equal(signature, bs58.encode(sig))
    assert.equal(sendCount, 1)
    assert.equal(statusPolls, 1)
  })
})
