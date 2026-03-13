/**
 * Verify a Solana SOL transfer used as raffle creation fee.
 * Transaction must be signed by expectedFrom and send at least minLamports to expectedTo.
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { getSolanaConnection } from '@/lib/solana/connection'

export async function verifyCreationFeeTransaction(
  transactionSignature: string,
  expectedFromWallet: string,
  expectedToWallet: string,
  minLamports: number
): Promise<{ valid: boolean; error?: string }> {
  try {
    const connection = getSolanaConnection()
    await new Promise((r) => setTimeout(r, 500))

    let tx = await connection.getTransaction(transactionSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
    if (!tx) {
      await new Promise((r) => setTimeout(r, 800))
      tx = await connection.getTransaction(transactionSignature, { commitment: 'confirmed' })
    }
    if (!tx) {
      return {
        valid: false,
        error: 'Transaction not found. It may still be confirming. Try again in a moment.',
      }
    }

    if (tx.meta?.err) {
      return { valid: false, error: 'Transaction failed on-chain.' }
    }

    const message = tx.transaction.message
    const accountKeys = 'staticAccountKeys' in message
      ? (message as { staticAccountKeys: PublicKey[] }).staticAccountKeys
      : (message as { accountKeys: PublicKey[] }).accountKeys

    const fromPubkey = new PublicKey(expectedFromWallet)
    const toPubkey = new PublicKey(expectedToWallet)

    const feePayerKey = accountKeys?.[0]
    if (!feePayerKey) {
      return { valid: false, error: 'Invalid transaction: no fee payer.' }
    }
    const feePayerMatches =
      typeof feePayerKey === 'string'
        ? feePayerKey === expectedFromWallet
        : feePayerKey.equals(fromPubkey)
    if (!feePayerMatches) {
      return {
        valid: false,
        error: 'Transaction was not signed by the expected wallet (creator).',
      }
    }

    const toIndex = accountKeys.findIndex((key: PublicKey | string) =>
      typeof key === 'string' ? key === expectedToWallet : (key as PublicKey).equals(toPubkey)
    )
    if (toIndex === -1) {
      return { valid: false, error: 'Recipient wallet not found in transaction.' }
    }

    const balanceIncrease =
      (tx.meta!.postBalances[toIndex] ?? 0) - (tx.meta!.preBalances[toIndex] ?? 0)
    if (balanceIncrease < minLamports) {
      return {
        valid: false,
        error: `Insufficient amount: expected at least ${minLamports} lamports, got ${balanceIncrease}.`,
      }
    }

    return { valid: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { valid: false, error: msg }
  }
}
