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
import {
  OWL_SEND_CONFIRM_TIMEOUT_HINT,
  OWL_SEND_CONFIRM_TIMEOUT_MS,
} from '@/lib/owl-send/confirm'
import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import { OWL_SEND_MAX_PER_TX } from '@/lib/owl-send/constants'
import type { OwlSendBatchResult } from '@/lib/owl-send/send-spl-nft-batch'

export type OwlSendTokenLine = {
  mint: string
  tokenAccount: string
  /** Raw amount in base units */
  amountRaw: bigint
  decimals: number
  symbol?: string
  /** When set, overrides the shared recipient (token scatter). */
  recipient?: string
}

/** Send up to 5 fungible token lines + Owl fee in one approval (one or many recipients). */
export async function sendOwlSendTokenLines(params: {
  connection: Connection
  owner: PublicKey
  /** Default recipient when a line omits `recipient`. */
  recipient?: string
  sendTransaction: WalletSendTransactionFn
  lines: OwlSendTokenLine[]
}): Promise<OwlSendBatchResult> {
  const { connection, owner, sendTransaction, lines } = params
  if (lines.length < 1) return { ok: false, error: 'Select at least one token amount to send.' }
  if (lines.length > OWL_SEND_MAX_PER_TX) {
    return {
      ok: false,
      error: `Max ${OWL_SEND_MAX_PER_TX} token lines per approval.`,
    }
  }

  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlSendFeeLamportsForCount(lines.length)
  if (feeLamports > 0 && !treasury) {
    return { ok: false, error: 'OwlSend fee treasury is not configured.' }
  }

  const tx = new Transaction()
  let newAtaCount = 0

  for (const line of lines) {
    if (line.amountRaw <= 0n) {
      return { ok: false, error: `Enter an amount greater than 0 for ${line.symbol ?? line.mint}.` }
    }
    const destRaw = (line.recipient ?? params.recipient ?? '').trim()
    if (!destRaw) {
      return { ok: false, error: 'Recipient wallet is required.' }
    }
    let recipientPk: PublicKey
    try {
      recipientPk = new PublicKey(destRaw)
    } catch {
      return { ok: false, error: `Recipient wallet is not a valid Solana address: ${destRaw.slice(0, 8)}…` }
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
    await confirmSignatureSuccessOnChain(
      connection,
      signature,
      OWL_SEND_CONFIRM_TIMEOUT_MS,
      OWL_SEND_CONFIRM_TIMEOUT_HINT
    )
    return { ok: true, signature, newAtaCount }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Send up to 5 fungible token lines to one recipient + Owl fee in one approval. */
export async function sendOwlSendTokensToOne(params: {
  connection: Connection
  owner: PublicKey
  recipient: string
  sendTransaction: WalletSendTransactionFn
  lines: OwlSendTokenLine[]
}): Promise<OwlSendBatchResult> {
  return sendOwlSendTokenLines({
    connection: params.connection,
    owner: params.owner,
    recipient: params.recipient,
    sendTransaction: params.sendTransaction,
    lines: params.lines,
  })
}
