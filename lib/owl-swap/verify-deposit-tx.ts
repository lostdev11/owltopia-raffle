/**
 * Verify OwlSwap deposit signatures by parsing the confirmed transaction.
 * Balance-only checks are insufficient (pooled escrow theft).
 */

import type { ParsedTransactionWithMeta } from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'

function tokenAmountForOwnerMint(
  balances: NonNullable<ParsedTransactionWithMeta['meta']>['preTokenBalances'],
  ownerB58: string,
  mintB58: string
): bigint {
  const row = (balances ?? []).find((b) => b.mint === mintB58 && b.owner === ownerB58)
  if (row?.uiTokenAmount?.amount == null) return 0n
  try {
    return BigInt(row.uiTokenAmount.amount)
  } catch {
    return 0n
  }
}

function accountKeysBase58(tx: ParsedTransactionWithMeta): string[] {
  const message = tx.transaction.message
  const keys = message.accountKeys ?? []
  return keys.map((k) => {
    if (typeof k === 'string') return k
    if (k && typeof k === 'object' && 'pubkey' in k) {
      const pk = (k as { pubkey: { toBase58(): string } | string }).pubkey
      return typeof pk === 'string' ? pk : pk.toBase58()
    }
    return String(k)
  })
}

function feePayerBase58(tx: ParsedTransactionWithMeta): string | null {
  const keys = accountKeysBase58(tx)
  return keys[0] ?? null
}

function solDeltaForAccount(tx: ParsedTransactionWithMeta, address: string): number {
  const keys = accountKeysBase58(tx)
  const idx = keys.findIndex((k) => k === address)
  if (idx < 0 || !tx.meta) return 0
  const pre = tx.meta.preBalances[idx] ?? 0
  const post = tx.meta.postBalances[idx] ?? 0
  return post - pre
}

export type VerifyOwlSwapDepositResult =
  | {
      ok: true
      feePayer: string
      escrowSolCreditLamports: number
      treasuryFeeCreditLamports: number
      mintsCreditedToEscrow: string[]
    }
  | { ok: false; error: string }

/**
 * Confirm a maker/taker deposit tx:
 * - fee payer must be `expectedPayer`
 * - each mint must show escrow token balance +1 (or more) and payer −1
 * - if expectedSolLamports > 0, escrow SOL credit must be ≥ that amount
 * - if expectedFeeLamports > 0, treasury SOL credit must be ≥ that amount
 */
export async function verifyOwlSwapDepositTransaction(params: {
  signature: string
  expectedPayer: string
  escrowAddress: string
  mints: string[]
  expectedSolLamports?: number
  treasuryAddress?: string | null
  expectedFeeLamports?: number
}): Promise<VerifyOwlSwapDepositResult> {
  const sig = params.signature.trim()
  if (!sig) return { ok: false, error: 'Missing deposit signature' }

  const connection = getSolanaConnection()
  let tx = await connection.getParsedTransaction(sig, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  })
  if (!tx) {
    // brief retry — tx may still be landing
    await new Promise((r) => setTimeout(r, 800))
    tx = await connection.getParsedTransaction(sig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    })
  }
  if (!tx?.meta || tx.meta.err) {
    return { ok: false, error: 'Deposit transaction not found or failed on-chain' }
  }

  const payer = feePayerBase58(tx)
  if (!payer || payer !== params.expectedPayer) {
    return {
      ok: false,
      error: 'Deposit transaction fee payer must be the signed-in wallet.',
    }
  }

  const credited: string[] = []
  for (const mint of params.mints) {
    const preEscrow = tokenAmountForOwnerMint(tx.meta.preTokenBalances, params.escrowAddress, mint)
    const postEscrow = tokenAmountForOwnerMint(tx.meta.postTokenBalances, params.escrowAddress, mint)
    const prePayer = tokenAmountForOwnerMint(tx.meta.preTokenBalances, params.expectedPayer, mint)
    const postPayer = tokenAmountForOwnerMint(tx.meta.postTokenBalances, params.expectedPayer, mint)

    const escrowDelta = postEscrow - preEscrow
    const payerDelta = postPayer - prePayer

    if (escrowDelta < 1n) {
      return {
        ok: false,
        error: `Deposit tx did not credit mint ${mint.slice(0, 8)}… to OwlSwap escrow.`,
      }
    }
    if (payerDelta > -1n) {
      return {
        ok: false,
        error: `Deposit tx did not debit mint ${mint.slice(0, 8)}… from your wallet.`,
      }
    }
    credited.push(mint)
  }

  const escrowSolCredit = solDeltaForAccount(tx, params.escrowAddress)
  const expectedSol = Math.max(0, Math.floor(params.expectedSolLamports ?? 0))
  if (expectedSol > 0 && escrowSolCredit < expectedSol) {
    return {
      ok: false,
      error: `Deposit tx SOL credit to escrow (${escrowSolCredit}) is below required ${expectedSol}.`,
    }
  }

  const expectedFee = Math.max(0, Math.floor(params.expectedFeeLamports ?? 0))
  let treasuryFeeCredit = 0
  if (expectedFee > 0) {
    const treasury = params.treasuryAddress?.trim()
    if (!treasury) {
      return { ok: false, error: 'Platform fee treasury is not configured.' }
    }
    treasuryFeeCredit = solDeltaForAccount(tx, treasury)
    if (treasuryFeeCredit < expectedFee) {
      return {
        ok: false,
        error: `Deposit tx must pay the Owl fee (${expectedFee} lamports) to the treasury in the same transaction.`,
      }
    }
  }

  return {
    ok: true,
    feePayer: payer,
    escrowSolCreditLamports: Math.max(0, escrowSolCredit),
    treasuryFeeCreditLamports: Math.max(0, treasuryFeeCredit),
    mintsCreditedToEscrow: credited,
  }
}
