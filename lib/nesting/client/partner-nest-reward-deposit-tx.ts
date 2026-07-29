'use client'

import { Connection, PublicKey, Transaction } from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
  getMint,
} from '@solana/spl-token'

type SendTransactionFn = (
  transaction: Transaction,
  connection: Connection,
  options?: {
    skipPreflight?: boolean
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized'
    maxRetries?: number
  }
) => Promise<string>

async function resolveTokenProgram(
  connection: Connection,
  mint: PublicKey
): Promise<typeof TOKEN_PROGRAM_ID | typeof TOKEN_2022_PROGRAM_ID> {
  const info = await connection.getAccountInfo(mint, 'confirmed')
  if (!info) throw new Error('Reward mint not found on-chain.')
  if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID
  if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID
  throw new Error('Reward mint is not SPL Token / Token-2022.')
}

/** Transfer partner reward SPL from the connected wallet into the Nesting reward vault ATA. */
export async function sendPartnerNestRewardDeposit(params: {
  connection: Connection
  sendTransaction: SendTransactionFn
  publicKey: PublicKey
  vaultWallet: string
  rewardMint: string
  amountUi: number
  decimals?: number
}): Promise<{ signature: string; decimals: number }> {
  if (!Number.isFinite(params.amountUi) || params.amountUi <= 0) {
    throw new Error('Invalid deposit amount.')
  }

  const mint = new PublicKey(params.rewardMint.trim())
  const vaultOwner = new PublicKey(params.vaultWallet.trim())
  const programId = await resolveTokenProgram(params.connection, mint)
  const mintInfo = await getMint(params.connection, mint, 'confirmed', programId)
  const decimals =
    params.decimals != null && Number.isInteger(params.decimals)
      ? params.decimals
      : mintInfo.decimals

  const raw = BigInt(Math.round(params.amountUi * Math.pow(10, decimals)))
  if (raw <= 0n) throw new Error('Deposit amount too small for this token’s decimals.')

  const fromAta = await getAssociatedTokenAddress(
    mint,
    params.publicKey,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const toAta = await getAssociatedTokenAddress(
    mint,
    vaultOwner,
    false,
    programId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  const tx = new Transaction()
  try {
    await getAccount(params.connection, toAta, 'confirmed', programId)
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        params.publicKey,
        toAta,
        vaultOwner,
        mint,
        programId,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(createTransferInstruction(fromAta, toAta, params.publicKey, raw, [], programId))

  const { blockhash, lastValidBlockHeight } = await params.connection.getLatestBlockhash('confirmed')
  tx.feePayer = params.publicKey
  tx.recentBlockhash = blockhash
  const signature = await params.sendTransaction(tx, params.connection, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })
  await params.connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    'confirmed'
  )
  return { signature, decimals }
}
