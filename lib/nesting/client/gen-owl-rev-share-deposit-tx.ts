'use client'

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
} from '@solana/spl-token'
import { getTokenInfo } from '@/lib/tokens'

type SendTransactionFn = (
  transaction: Transaction,
  connection: Connection,
  options?: {
    skipPreflight?: boolean
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized'
    maxRetries?: number
  }
) => Promise<string>

async function sendAndConfirm(
  connection: Connection,
  sendTransaction: SendTransactionFn,
  publicKey: PublicKey,
  tx: Transaction
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed')
  tx.feePayer = publicKey
  tx.recentBlockhash = blockhash
  const signature = await sendTransaction(tx, connection, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
    maxRetries: 3,
  })
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed')
  return signature
}

/** Transfer SOL from the connected admin wallet to the rev-share pool. */
export async function sendGenOwlRevShareSolDeposit(params: {
  connection: Connection
  sendTransaction: SendTransactionFn
  publicKey: PublicKey
  poolWallet: string
  amountSol: number
}): Promise<string> {
  const lamports = Math.round(params.amountSol * LAMPORTS_PER_SOL)
  if (!Number.isFinite(lamports) || lamports <= 0) {
    throw new Error('Invalid SOL deposit amount.')
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: params.publicKey,
      toPubkey: new PublicKey(params.poolWallet.trim()),
      lamports,
    })
  )
  return sendAndConfirm(params.connection, params.sendTransaction, params.publicKey, tx)
}

/** Transfer USDC from the connected admin wallet to the rev-share pool ATA. */
export async function sendGenOwlRevShareUsdcDeposit(params: {
  connection: Connection
  sendTransaction: SendTransactionFn
  publicKey: PublicKey
  poolWallet: string
  amountUsdc: number
}): Promise<string> {
  const tokenInfo = getTokenInfo('USDC')
  if (!tokenInfo.mintAddress) {
    throw new Error('USDC mint not configured.')
  }
  const decimals = tokenInfo.decimals
  const raw = BigInt(Math.round(params.amountUsdc * Math.pow(10, decimals)))
  if (raw <= 0n) {
    throw new Error('Invalid USDC deposit amount.')
  }

  const mint = new PublicKey(tokenInfo.mintAddress)
  const poolOwner = new PublicKey(params.poolWallet.trim())
  const fromAta = await getAssociatedTokenAddress(
    mint,
    params.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )
  const toAta = await getAssociatedTokenAddress(
    mint,
    poolOwner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID
  )

  const tx = new Transaction()
  try {
    await getAccount(params.connection, toAta, 'confirmed', TOKEN_PROGRAM_ID)
  } catch {
    tx.add(
      createAssociatedTokenAccountInstruction(
        params.publicKey,
        toAta,
        poolOwner,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    )
  }
  tx.add(createTransferInstruction(fromAta, toAta, params.publicKey, raw, [], TOKEN_PROGRAM_ID))
  return sendAndConfirm(params.connection, params.sendTransaction, params.publicKey, tx)
}
