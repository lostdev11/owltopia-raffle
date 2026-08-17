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
  treasury: string
  unitLamports: number
}

/**
 * Sends the coin art upgrade fee to the platform treasury (units × per-coin fee).
 * Config comes from `GET /api/me/coin-upgrade` so no NEXT_PUBLIC_* env is needed.
 * Returns the tx signature the server verifies before repointing the art.
 */
export async function sendCoinArtUpgradeFeeTransaction(params: {
  connection: Connection
  sendTransaction: SendTransactionFn
  publicKey: PublicKey
  units: number
  feeConfig: CoinArtUpgradeFeeTxConfig
}): Promise<string> {
  const treasury = params.feeConfig.treasury?.trim() || ''
  const unitLamports = params.feeConfig.unitLamports
  if (!treasury || unitLamports <= 0) {
    throw new Error('Coin art upgrade fee is not configured.')
  }

  const units = Math.floor(params.units)
  if (!Number.isFinite(units) || units <= 0) {
    throw new Error('Invalid coin count for the upgrade fee.')
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: params.publicKey,
      toPubkey: new PublicKey(treasury),
      lamports: units * unitLamports,
    })
  )

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
