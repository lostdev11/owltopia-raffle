import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getSolanaReadConnection } from '@/lib/solana/connection'
import { getFullAccountKeysForTransaction } from '@/lib/verify-transaction'
import { PACK_PRICE_SOL, packPriceLamports } from '@/lib/packs/config'
import { getPacksVaultPublicKey } from '@/lib/packs/vault'

const SOL_TOLERANCE = 0.000_01 // ~10k lamports

export type PackPaymentVerifyResult =
  | { ok: true; lamports: number; buyer: string }
  | { ok: false; error: string }

/**
 * Verify a SOL transfer of pack price from buyer → packs vault.
 */
export async function verifyPackPayment(input: {
  signature: string
  buyerWallet: string
  expectedSol?: number
  connection?: Connection
}): Promise<PackPaymentVerifyResult> {
  const vault = getPacksVaultPublicKey()
  if (!vault) {
    return { ok: false, error: 'Packs vault wallet is not configured' }
  }

  const expectedSol = input.expectedSol ?? PACK_PRICE_SOL
  const expectedLamports = Number(
    input.expectedSol != null
      ? BigInt(Math.round(input.expectedSol * LAMPORTS_PER_SOL))
      : packPriceLamports()
  )

  const connection = input.connection ?? getSolanaReadConnection()
  let tx
  try {
    tx = await connection.getTransaction(input.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to fetch transaction' }
  }

  if (!tx?.meta || tx.meta.err) {
    return { ok: false, error: 'Transaction not found or failed on-chain' }
  }

  const keys = getFullAccountKeysForTransaction({
    transaction: tx.transaction,
    meta: tx.meta,
  })
  const vaultPk = new PublicKey(vault)
  const buyerPk = new PublicKey(input.buyerWallet.trim())

  const vaultIndex = keys.findIndex((k) => k.equals(vaultPk))
  const buyerIndex = keys.findIndex((k) => k.equals(buyerPk))

  if (vaultIndex < 0) {
    return { ok: false, error: 'Packs vault was not a transaction account' }
  }
  if (buyerIndex < 0) {
    return { ok: false, error: 'Buyer wallet was not a transaction account' }
  }

  const vaultIncrease =
    (tx.meta.postBalances[vaultIndex]! - tx.meta.preBalances[vaultIndex]!) / LAMPORTS_PER_SOL
  const buyerDecrease =
    (tx.meta.preBalances[buyerIndex]! - tx.meta.postBalances[buyerIndex]!) / LAMPORTS_PER_SOL

  if (vaultIncrease + SOL_TOLERANCE < expectedSol) {
    return {
      ok: false,
      error: `Vault received ${vaultIncrease.toFixed(6)} SOL; expected ${expectedSol} SOL`,
    }
  }

  if (buyerDecrease + SOL_TOLERANCE < expectedSol) {
    return {
      ok: false,
      error: `Buyer spend ${buyerDecrease.toFixed(6)} SOL below pack price`,
    }
  }

  return {
    ok: true,
    lamports: Math.round(vaultIncrease * LAMPORTS_PER_SOL) || expectedLamports,
    buyer: buyerPk.toBase58(),
  }
}
