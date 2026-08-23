'use client'

import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

type SendTransactionFn = (
  transaction: Transaction,
  connection: Connection,
  options?: {
    skipPreflight?: boolean
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized'
    maxRetries?: number
  }
) => Promise<string>

export type CoinArtUpgradeFeeTxConfig = {
  wallet_a: string
  wallet_b: string
  percent_a: number
  percent_b: number
  unit_lamports: number
}

/**
 * Sends the coin art upgrade fee 50/50 to the two founder wallets.
 * Config comes from `GET /api/me/coin-upgrade` so no NEXT_PUBLIC_* env is needed.
 */
export async function sendCoinArtUpgradeFeeTransaction(params: {
  connection: Connection
  sendTransaction: SendTransactionFn
  publicKey: PublicKey
  units: number
  feeConfig: CoinArtUpgradeFeeTxConfig
}): Promise<string> {
  const walletA = params.feeConfig.wallet_a?.trim() || ''
  const walletB = params.feeConfig.wallet_b?.trim() || ''
  const unitLamports = params.feeConfig.unit_lamports
  if (!walletA || !walletB || unitLamports <= 0) {
    throw new Error('Coin art upgrade fee is not configured.')
  }

  const units = Math.floor(params.units)
  if (!Number.isFinite(units) || units <= 0) {
    throw new Error('Invalid coin count for the upgrade fee.')
  }

  const totalLamports = BigInt(units) * BigInt(unitLamports)
  const walletALamports = (totalLamports * BigInt(params.feeConfig.percent_a)) / 100n
  const walletBLamports = totalLamports - walletALamports

  const tx = new Transaction()
  if (walletALamports > 0n) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: params.publicKey,
        toPubkey: new PublicKey(walletA),
        lamports: Number(walletALamports),
      })
    )
  }
  if (walletBLamports > 0n) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: params.publicKey,
        toPubkey: new PublicKey(walletB),
        lamports: Number(walletBLamports),
      })
    )
  }
  if (tx.instructions.length === 0) {
    throw new Error('Coin art upgrade fee amount is zero.')
  }

  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash('confirmed')
  tx.feePayer = params.publicKey
  tx.recentBlockhash = blockhash

  const signature = await params.sendTransaction(tx, params.connection, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })
  await params.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}
