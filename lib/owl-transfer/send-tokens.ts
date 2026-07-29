'use client'

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js'
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import { getOwlTransferFeeLamportsForCount } from '@/lib/owl-transfer/fee'
import { OWL_TRANSFER_MAX_PER_TX } from '@/lib/owl-transfer/constants'
import type { OwlTransferBatchResult } from '@/lib/owl-transfer/send-spl-nft-batch'

export type OwlTransferTokenLine = {
  mint: string
  tokenAccount: string
  /** Raw amount in base units */
  amountRaw: bigint
  decimals: number
  symbol?: string
}

/** Send up to 5 fungible token lines to one recipient + Owl fee in one approval. */
export async function sendOwlTransferTokensToOne(params: {
  connection: Connection
  owner: PublicKey
  recipient: string
  sendTransaction: WalletSendTransactionFn
  lines: OwlTransferTokenLine[]
}): Promise<OwlTransferBatchResult> {
  const { connection, owner, sendTransaction, lines } = params
  if (lines.length < 1) return { ok: false, error: 'Select at least one token amount to send.' }
  if (lines.length > OWL_TRANSFER_MAX_PER_TX) {
    return {
      ok: false,
      error: `Max ${OWL_TRANSFER_MAX_PER_TX} token lines per approval.`,
    }
  }

  let recipientPk: PublicKey
  try {
    recipientPk = new PublicKey(params.recipient.trim())
  } catch {
    return { ok: false, error: 'Recipient wallet is not a valid Solana address.' }
  }

  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlTransferFeeLamportsForCount(lines.length)
  if (feeLamports > 0 && !treasury) {
    return { ok: false, error: 'Owl Transfer fee treasury is not configured.' }
  }

  const tx = new Transaction()
  let newAtaCount = 0

  for (const line of lines) {
    if (line.amountRaw <= 0n) {
      return { ok: false, error: `Enter an amount greater than 0 for ${line.symbol ?? line.mint}.` }
    }
    const mintPk = new PublicKey(line.mint)
    const source = new PublicKey(line.tokenAccount)
    const destAta = await getAssociatedTokenAddress(
      mintPk,
      recipientPk,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    try {
      await getAccount(connection, destAta, 'confirmed', TOKEN_PROGRAM_ID)
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          owner,
          destAta,
          recipientPk,
          mintPk,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
      newAtaCount += 1
    }
    tx.add(
      createTransferInstruction(source, destAta, owner, line.amountRaw, [], TOKEN_PROGRAM_ID)
    )
  }

  if (feeLamports > 0 && treasury) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: new PublicKey(treasury),
        lamports: feeLamports,
      })
    )
  }

  try {
    const signature = await sendTransaction(tx, connection, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    })
    await confirmSignatureSuccessOnChain(connection, signature)
    return { ok: true, signature, newAtaCount }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
