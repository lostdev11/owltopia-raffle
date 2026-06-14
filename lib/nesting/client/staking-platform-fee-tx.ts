'use client'

import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'

import {
  getStakingPlatformFeeLamports,
  isStakingPlatformFeeEnabledClient,
} from '@/lib/nesting/staking-platform-fee'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'

type SendTransactionFn = (
  transaction: Transaction,
  connection: Connection,
  options?: { skipPreflight?: boolean; preflightCommitment?: 'processed' | 'confirmed' | 'finalized'; maxRetries?: number }
) => Promise<string>

export type StakingPlatformFeeTxConfig = {
  treasury: string
  unitLamports: number
}

/**
 * Sends SOL platform fee to treasury (units × per-nest fee). Returns tx signature.
 * Pass `feeConfig` from `/api/staking/pools` so nesting fees work without NEXT_PUBLIC_* in the client bundle.
 */
export async function sendStakingPlatformFeeTransaction(params: {
  connection: Connection
  sendTransaction: SendTransactionFn
  publicKey: PublicKey
  units: number
  feeConfig?: StakingPlatformFeeTxConfig | null
}): Promise<string> {
  const treasury =
    params.feeConfig?.treasury?.trim() || getPlatformFeeTreasuryWalletAddressClient()?.trim() || ''
  const unitLamports = params.feeConfig?.unitLamports ?? getStakingPlatformFeeLamports()

  if (!treasury || unitLamports <= 0) {
    if (!isStakingPlatformFeeEnabledClient()) {
      throw new Error('Platform fee is not configured.')
    }
    throw new Error('Platform fee treasury is not configured.')
  }

  const units = Math.floor(params.units)
  if (!Number.isFinite(units) || units <= 0) {
    throw new Error('Invalid platform fee nest count.')
  }

  const lamports = units * unitLamports
  if (lamports <= 0) {
    throw new Error('Platform fee amount is zero.')
  }

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: params.publicKey,
      toPubkey: new PublicKey(treasury),
      lamports,
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
