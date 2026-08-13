/**
 * Unit tests for OwlSend ledger recover draft (Core + SPL attribution).
 * Run: npx tsx scripts/test-owl-send-recover-ledger.ts
 */
import assert from 'node:assert/strict'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  MPL_CORE_PROGRAM_ID,
  MPL_CORE_TRANSFER_V1_DISCRIMINATOR,
} from '@/lib/owl-send/mpl-core-ledger-transfers'
import { buildOwlSendLedgerDraftFromTx } from '@/lib/owl-send/recover-ledger-tx'

const payer = PublicKey.unique()
const asset = PublicKey.unique()
const collection = PublicKey.unique()
const newOwner = PublicKey.unique()
const treasury = PublicKey.unique()

// Fee enabled + treasury present so recover accepts OwlSend-shaped txs.
process.env.OWL_SEND_FEE_SOL = '0.0005'
process.env.OWL_PLATFORM_FEE_TREASURY_WALLET = treasury.toBase58()
process.env.NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET = treasury.toBase58()

function encodeTransferV1Data(): string {
  return bs58.encode(Uint8Array.from([MPL_CORE_TRANSFER_V1_DISCRIMINATOR, 0]))
}

function metaBalances(keys: PublicKey[], deltas: Map<string, number>) {
  const preBalances = keys.map((k) => {
    const d = deltas.get(k.toBase58()) ?? 0
    // If treasury gains, start lower
    return d > 0 ? 1_000_000 : 2_000_000
  })
  const postBalances = keys.map((k, i) => {
    const d = deltas.get(k.toBase58()) ?? 0
    return preBalances[i]! + d
  })
  return { preBalances, postBalances }
}

{
  const keys = [
    payer,
    asset,
    collection,
    MPL_CORE_PROGRAM_ID,
    newOwner,
    SystemProgram.programId,
    treasury,
  ]
  const accountIndexes = [1, 2, 0, 3, 4, 5]
  const feeLamports = 500_000
  const { preBalances, postBalances } = metaBalances(
    keys,
    new Map([[treasury.toBase58(), feeLamports]])
  )

  const transaction = {
    transaction: {
      message: {
        accountKeys: keys,
        compiledInstructions: [
          {
            programIdIndex: 3,
            accounts: accountIndexes,
            data: encodeTransferV1Data(),
          },
        ],
      },
    },
    meta: {
      err: null,
      preBalances,
      postBalances,
      preTokenBalances: [],
      postTokenBalances: [],
      innerInstructions: [],
    },
  }

  const result = buildOwlSendLedgerDraftFromTx({
    signature: 'RecoverSig1111111111111111111111111111111111111111111111111',
    fromWallet: payer.toBase58(),
    transaction: transaction as any,
  })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  assert.equal(result.draft.assetKind, 'nft')
  assert.equal(result.draft.mode, 'nft_one')
  assert.equal(result.draft.lines.length, 1)
  assert.equal(result.draft.lines[0]!.mint, asset.toBase58())
  assert.equal(result.draft.lines[0]!.recipient, newOwner.toBase58())
  assert.equal(result.draft.feeLamports, feeLamports)
}

{
  // Wrong fee payer rejected
  const stranger = PublicKey.unique()
  const keys = [stranger, asset, MPL_CORE_PROGRAM_ID, newOwner, treasury]
  const { preBalances, postBalances } = metaBalances(
    keys,
    new Map([[treasury.toBase58(), 500_000]])
  )
  const result = buildOwlSendLedgerDraftFromTx({
    signature: 'RecoverSig2222222222222222222222222222222222222222222222222',
    fromWallet: payer.toBase58(),
    transaction: {
      transaction: {
        message: {
          accountKeys: keys,
          compiledInstructions: [
            {
              programIdIndex: 2,
              accounts: [1, 2, 0, 2, 3],
              data: encodeTransferV1Data(),
            },
          ],
        },
      },
      meta: {
        err: null,
        preBalances,
        postBalances,
        preTokenBalances: [],
        postTokenBalances: [],
        innerInstructions: [],
      },
    } as any,
  })
  assert.equal(result.ok, false)
}

{
  // No Owl fee → reject when fee is enabled
  const keys = [payer, asset, MPL_CORE_PROGRAM_ID, newOwner, treasury]
  const { preBalances, postBalances } = metaBalances(keys, new Map())
  const result = buildOwlSendLedgerDraftFromTx({
    signature: 'RecoverSig3333333333333333333333333333333333333333333333333',
    fromWallet: payer.toBase58(),
    transaction: {
      transaction: {
        message: {
          accountKeys: keys,
          compiledInstructions: [
            {
              programIdIndex: 2,
              accounts: [1, 2, 0, 2, 3],
              data: encodeTransferV1Data(),
            },
          ],
        },
      },
      meta: {
        err: null,
        preBalances,
        postBalances,
        preTokenBalances: [],
        postTokenBalances: [],
        innerInstructions: [],
      },
    } as any,
  })
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('expected failure')
  assert.match(result.error, /Owl fee/i)
}

{
  // SPL NFT balance attribution
  const mint = PublicKey.unique()
  const recipient = PublicKey.unique()
  const keys = [payer, mint, recipient, treasury]
  const feeLamports = 500_000
  const { preBalances, postBalances } = metaBalances(
    keys,
    new Map([[treasury.toBase58(), feeLamports]])
  )
  const result = buildOwlSendLedgerDraftFromTx({
    signature: 'RecoverSig4444444444444444444444444444444444444444444444444',
    fromWallet: payer.toBase58(),
    transaction: {
      transaction: { message: { accountKeys: keys, compiledInstructions: [] } },
      meta: {
        err: null,
        preBalances,
        postBalances,
        preTokenBalances: [
          {
            owner: payer.toBase58(),
            mint: mint.toBase58(),
            uiTokenAmount: { amount: '1', decimals: 0 },
          },
        ],
        postTokenBalances: [
          {
            owner: recipient.toBase58(),
            mint: mint.toBase58(),
            uiTokenAmount: { amount: '1', decimals: 0 },
          },
        ],
        innerInstructions: [],
      },
    } as any,
  })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error(result.error)
  assert.equal(result.draft.assetKind, 'nft')
  assert.equal(result.draft.lines[0]!.mint, mint.toBase58())
  assert.equal(result.draft.lines[0]!.recipient, recipient.toBase58())
}

console.log('test-owl-send-recover-ledger: ok')
