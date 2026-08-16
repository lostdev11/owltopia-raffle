/**
 * Unit tests for OwlSend MPL Core TransferV1 ledger parsing / matching.
 * Run: npx tsx scripts/test-owl-send-mpl-core-ledger.ts
 */
import assert from 'node:assert/strict'
import { PublicKey, SystemProgram } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  MPL_CORE_PROGRAM_ID,
  MPL_CORE_TRANSFER_V1_DISCRIMINATOR,
  collectMplCoreTransferV1FromTx,
  mplCoreTransferCoversLedgerLine,
} from '@/lib/owl-send/mpl-core-ledger-transfers'

const asset = PublicKey.unique()
const collection = PublicKey.unique()
const payer = PublicKey.unique()
const newOwner = PublicKey.unique()
const otherOwner = PublicKey.unique()
const otherAsset = PublicKey.unique()

function encodeTransferV1Data(): string {
  // discriminator 14 + Option::None for compressionProof
  return bs58.encode(Uint8Array.from([MPL_CORE_TRANSFER_V1_DISCRIMINATOR, 0]))
}

{
  // Full account list with Core TransferV1 (collection present, authority = program placeholder)
  const keys = [
    payer,
    asset,
    collection,
    MPL_CORE_PROGRAM_ID,
    newOwner,
    SystemProgram.programId,
  ]
  // ix accounts: asset, collection, payer, authority(programId), new_owner, system
  const accountIndexes = [1, 2, 0, 3, 4, 5]
  const tx = {
    transaction: {
      message: {
        compiledInstructions: [
          {
            programIdIndex: 3,
            accounts: accountIndexes,
            data: encodeTransferV1Data(),
          },
        ],
      },
    },
    meta: { innerInstructions: [] },
  }

  const transfers = collectMplCoreTransferV1FromTx(tx, keys)
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0]!.asset, asset.toBase58())
  assert.equal(transfers[0]!.newOwner, newOwner.toBase58())
  assert.equal(transfers[0]!.payer, payer.toBase58())
  assert.equal(transfers[0]!.authority, null)

  assert.equal(
    mplCoreTransferCoversLedgerLine(transfers, {
      mint: asset.toBase58(),
      recipient: newOwner.toBase58(),
      fromWallet: payer.toBase58(),
    }),
    true
  )
  assert.equal(
    mplCoreTransferCoversLedgerLine(transfers, {
      mint: asset.toBase58(),
      recipient: otherOwner.toBase58(),
      fromWallet: payer.toBase58(),
    }),
    false
  )
  assert.equal(
    mplCoreTransferCoversLedgerLine(transfers, {
      mint: otherAsset.toBase58(),
      recipient: newOwner.toBase58(),
      fromWallet: payer.toBase58(),
    }),
    false
  )
  assert.equal(
    mplCoreTransferCoversLedgerLine(transfers, {
      mint: asset.toBase58(),
      recipient: newOwner.toBase58(),
      fromWallet: otherOwner.toBase58(),
    }),
    false
  )
}

{
  // Inner-instruction TransferV1 (same layout; authority = payer)
  const keys = [payer, asset, MPL_CORE_PROGRAM_ID, newOwner, SystemProgram.programId]
  const accountIndexes = [1, 2, 0, 0, 3, 4] // collection = program placeholder
  const tx = {
    transaction: {
      message: {
        instructions: [
          {
            programIdIndex: 4,
            accounts: [0],
            data: bs58.encode(Uint8Array.from([0])),
          },
        ],
      },
    },
    meta: {
      innerInstructions: [
        {
          instructions: [
            {
              programIdIndex: 2,
              accounts: accountIndexes,
              data: encodeTransferV1Data(),
            },
          ],
        },
      ],
    },
  }

  const transfers = collectMplCoreTransferV1FromTx(tx, keys)
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0]!.asset, asset.toBase58())
  assert.equal(transfers[0]!.newOwner, newOwner.toBase58())
  assert.equal(transfers[0]!.payer, payer.toBase58())
}

{
  // Live OwlSend Core Transfer data ("24o") is TransferV1
  const keys = [payer, asset, collection, MPL_CORE_PROGRAM_ID, newOwner]
  const tx = {
    transaction: {
      message: {
        compiledInstructions: [
          {
            programIdIndex: 3,
            accounts: [1, 2, 0, 3, 4, 3, 3],
            data: '24o',
          },
        ],
      },
    },
  }
  const transfers = collectMplCoreTransferV1FromTx(tx, keys)
  assert.equal(transfers.length, 1)
  assert.equal(transfers[0]!.asset, asset.toBase58())
  assert.equal(transfers[0]!.newOwner, newOwner.toBase58())
}

{
  // Wrong discriminator is ignored
  const keys = [payer, asset, MPL_CORE_PROGRAM_ID, newOwner]
  const tx = {
    transaction: {
      message: {
        compiledInstructions: [
          {
            programIdIndex: 2,
            accounts: [1, 2, 0, 2, 3],
            data: bs58.encode(Uint8Array.from([15, 0])), // UpdateV1, not TransferV1
          },
        ],
      },
    },
  }
  assert.equal(collectMplCoreTransferV1FromTx(tx, keys).length, 0)
}

{
  // Empty token-balance path simulation: Core match alone is enough for ledger line
  const transfers = [
    {
      asset: asset.toBase58(),
      newOwner: newOwner.toBase58(),
      payer: payer.toBase58(),
      authority: null,
    },
  ]
  assert.ok(
    mplCoreTransferCoversLedgerLine(transfers, {
      mint: asset.toBase58(),
      recipient: newOwner.toBase58(),
      fromWallet: payer.toBase58(),
    })
  )
}

console.log('test-owl-send-mpl-core-ledger: ok')
