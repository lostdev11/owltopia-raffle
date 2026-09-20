import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getSolanaReadConnection } from '@/lib/solana/connection'
import { getFullAccountKeysForTransaction } from '@/lib/verify-transaction'
import {
  PACK_PRICE_OWL,
  PACK_PRICE_SOL,
  packPriceLamports,
  type PackPaymentCurrency,
} from '@/lib/packs/config'
import { getPacksVaultPublicKey } from '@/lib/packs/vault'
import { MAX_SUPPORTED_TRANSACTION_VERSION } from '@/lib/solana/transaction-version'
import { getTokenInfo, isOwlEnabled } from '@/lib/tokens'
import { owlUiToRawBigint } from '@/lib/council/owl-amount-format'

const SOL_TOLERANCE = 0.000_01 // ~10k lamports

export type PackPaymentVerifyResult =
  | { ok: true; lamports: number; buyer: string; currency: PackPaymentCurrency }
  | { ok: false; error: string }

type TokenBalanceRow = {
  mint: string
  owner?: string
  uiTokenAmount?: { amount?: string } | null
}

function tokenAmountRaw(row: TokenBalanceRow | undefined): bigint {
  const amt = row?.uiTokenAmount?.amount
  if (typeof amt !== 'string' || !/^\d+$/.test(amt)) return 0n
  return BigInt(amt)
}

/**
 * Pure helper exported for unit tests / reuse.
 * Token balance delta for an owner+mint from pre/post token balance arrays.
 */
export function packTokenBalanceDeltaForOwnerMint(
  pre: TokenBalanceRow[] | null | undefined,
  post: TokenBalanceRow[] | null | undefined,
  ownerB58: string,
  mintB58: string
): bigint {
  const preB = (pre ?? []).find((b) => b.mint === mintB58 && b.owner === ownerB58)
  const postB = (post ?? []).find((b) => b.mint === mintB58 && b.owner === ownerB58)
  return tokenAmountRaw(postB) - tokenAmountRaw(preB)
}

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
      maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
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
    currency: 'SOL',
  }
}

/**
 * Verify OWL pack checkout: vault receives ≥ expected OWL + ≥ expected SOL fee.
 */
export async function verifyPackOwlPayment(input: {
  signature: string
  buyerWallet: string
  expectedOwl?: number
  expectedFeeSol: number
  connection?: Connection
}): Promise<PackPaymentVerifyResult> {
  const vault = getPacksVaultPublicKey()
  if (!vault) {
    return { ok: false, error: 'Packs vault wallet is not configured' }
  }
  if (!isOwlEnabled()) {
    return { ok: false, error: 'OWL is not configured (NEXT_PUBLIC_OWL_MINT_ADDRESS)' }
  }
  const owl = getTokenInfo('OWL')
  if (!owl.mintAddress) {
    return { ok: false, error: 'OWL mint address missing' }
  }

  const expectedOwl = input.expectedOwl ?? PACK_PRICE_OWL
  const expectedOwlRaw = owlUiToRawBigint(expectedOwl, owl.decimals)
  if (expectedOwlRaw <= 0n) {
    return { ok: false, error: 'Invalid expected OWL amount' }
  }
  if (!(input.expectedFeeSol > 0)) {
    return { ok: false, error: 'Invalid expected SOL fee' }
  }

  const connection = input.connection ?? getSolanaReadConnection()
  let tx
  try {
    tx = await connection.getTransaction(input.signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: MAX_SUPPORTED_TRANSACTION_VERSION,
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

  const vaultSolIncrease =
    (tx.meta.postBalances[vaultIndex]! - tx.meta.preBalances[vaultIndex]!) / LAMPORTS_PER_SOL

  if (vaultSolIncrease + SOL_TOLERANCE < input.expectedFeeSol) {
    return {
      ok: false,
      error: `Vault received ${vaultSolIncrease.toFixed(6)} SOL fee; expected ${input.expectedFeeSol.toFixed(6)} SOL`,
    }
  }

  const vaultOwlDelta = packTokenBalanceDeltaForOwnerMint(
    tx.meta.preTokenBalances as TokenBalanceRow[] | null | undefined,
    tx.meta.postTokenBalances as TokenBalanceRow[] | null | undefined,
    vaultPk.toBase58(),
    owl.mintAddress
  )

  if (vaultOwlDelta < expectedOwlRaw) {
    const got = Number(vaultOwlDelta) / 10 ** owl.decimals
    return {
      ok: false,
      error: `Vault received ${got} $OWL; expected ${expectedOwl} $OWL`,
    }
  }

  return {
    ok: true,
    lamports: Math.round(vaultSolIncrease * LAMPORTS_PER_SOL),
    buyer: buyerPk.toBase58(),
    currency: 'OWL',
  }
}
