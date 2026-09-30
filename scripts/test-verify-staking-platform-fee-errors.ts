/**
 * Unit tests for verifyStakingPlatformFeeTransaction error splitting
 * (not-found vs failed on-chain) when a parsed tx is supplied.
 * Run: npx tsx scripts/test-verify-staking-platform-fee-errors.ts
 */
import assert from 'node:assert/strict'
import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { Keypair } from '@solana/web3.js'

import {
  FEE_TX_FAILED_ONCHAIN_ERROR,
  FEE_TX_NOT_FOUND_ERROR,
} from '../lib/nesting/staking-platform-fee-errors'
import { verifyStakingPlatformFeeTransaction } from '../lib/nesting/verify-staking-platform-fee'

const from = Keypair.generate()
const treasury = Keypair.generate()
const unitLamports = 100_000

function baseParsed(overrides: {
  err?: unknown
  meta?: null
  pre?: number[]
  post?: number[]
}): ParsedTransactionWithMeta {
  const err = overrides.err === undefined ? null : overrides.err
  if (overrides.meta === null) {
    return {
      slot: 1,
      transaction: {
        message: {
          accountKeys: [
            { pubkey: from.publicKey, signer: true, writable: true },
            { pubkey: treasury.publicKey, signer: false, writable: true },
          ],
          instructions: [],
          recentBlockhash: '11111111111111111111111111111111',
        },
        signatures: ['sig'],
      },
      meta: null,
    } as unknown as ParsedTransactionWithMeta
  }
  return {
    slot: 1,
    transaction: {
      message: {
        accountKeys: [
          { pubkey: from.publicKey, signer: true, writable: true },
          { pubkey: treasury.publicKey, signer: false, writable: true },
        ],
        instructions: [],
        recentBlockhash: '11111111111111111111111111111111',
      },
      signatures: ['sig'],
    },
    meta: {
      err,
      fee: 5000,
      preBalances: overrides.pre ?? [1_000_000_000, 0],
      postBalances: overrides.post ?? [1_000_000_000 - unitLamports - 5000, unitLamports],
      innerInstructions: [],
      logMessages: [],
      preTokenBalances: [],
      postTokenBalances: [],
      rewards: [],
    },
  } as unknown as ParsedTransactionWithMeta
}

async function main() {
  const missing = await verifyStakingPlatformFeeTransaction({
    signature: 'missing',
    fromWallet: from.publicKey.toBase58(),
    treasuryWallet: treasury.publicKey.toBase58(),
    minUnits: 1,
    unitLamports,
    parsed: null,
  })
  assert.equal(missing.ok, false)
  if (!missing.ok) assert.equal(missing.error, FEE_TX_NOT_FOUND_ERROR)

  const noMeta = await verifyStakingPlatformFeeTransaction({
    signature: 'nometa',
    fromWallet: from.publicKey.toBase58(),
    treasuryWallet: treasury.publicKey.toBase58(),
    minUnits: 1,
    unitLamports,
    parsed: baseParsed({ meta: null }),
  })
  assert.equal(noMeta.ok, false)
  if (!noMeta.ok) assert.equal(noMeta.error, FEE_TX_NOT_FOUND_ERROR)

  const failed = await verifyStakingPlatformFeeTransaction({
    signature: 'failed',
    fromWallet: from.publicKey.toBase58(),
    treasuryWallet: treasury.publicKey.toBase58(),
    minUnits: 1,
    unitLamports,
    parsed: baseParsed({ err: { InstructionError: [0, 'Custom'] } }),
  })
  assert.equal(failed.ok, false)
  if (!failed.ok) assert.equal(failed.error, FEE_TX_FAILED_ONCHAIN_ERROR)

  const ok = await verifyStakingPlatformFeeTransaction({
    signature: 'ok',
    fromWallet: from.publicKey.toBase58(),
    treasuryWallet: treasury.publicKey.toBase58(),
    minUnits: 1,
    unitLamports,
    parsed: baseParsed({}),
  })
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.units, 1)
    assert.equal(ok.lamports, unitLamports)
  }

  console.log('test-verify-staking-platform-fee-errors: ok')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
