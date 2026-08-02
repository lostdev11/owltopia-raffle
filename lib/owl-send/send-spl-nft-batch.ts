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
} from '@solana/spl-token'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { getNftHolderInWallet } from '@/lib/solana/wallet-tokens'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import { assertNftTransferable } from '@/lib/owl-send/assert-nft-transferable'
import {
  OWL_SEND_CONFIRM_TIMEOUT_HINT,
  OWL_SEND_CONFIRM_TIMEOUT_MS,
} from '@/lib/owl-send/confirm'
import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import { OWL_SEND_MAX_PER_TX } from '@/lib/owl-send/constants'
import type { OwlSendLine } from '@/lib/owl-send/batch'

export type OwlSendBatchResult =
  | { ok: true; signature: string; newAtaCount: number }
  | { ok: false; error: string; failedMints?: string[] }

/** UI phases while a batch is in flight (wallet approve → RPC confirm). */
export type OwlSendSendPhase = 'building' | 'approving' | 'confirming'

async function resolveHolder(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  hintTokenAccount?: string | null
) {
  const preflight = await assertNftTransferable({
    connection,
    mint: mint.toBase58(),
    owner,
    tokenAccount: hintTokenAccount,
  })
  if (preflight.ok) {
    return { tokenProgram: preflight.tokenProgram, tokenAccount: preflight.tokenAccount }
  }
  if (preflight.reason === 'frozen') {
    throw new Error(preflight.error)
  }

  // Fallback for non-ATA holdings. Leftover delegates without freeze are still owner-sendable.
  const h = await getNftHolderInWallet(connection, mint, owner, 'processed')
  if (h && 'tokenProgram' in h && 'tokenAccount' in h) {
    try {
      const acc = await getAccount(connection, h.tokenAccount, 'processed', h.tokenProgram)
      if (acc.isFrozen) {
        throw new Error(
          `NFT ${mint.toBase58().slice(0, 4)}… is frozen (often nested) — unnest or thaw before sending.`
        )
      }
    } catch (e) {
      if (e instanceof Error && /frozen|unnest|thaw/i.test(e.message)) throw e
    }
    return h
  }
  return null
}

/**
 * Send up to 5 classic SPL / Token-2022 NFTs + Owl fee in one wallet approval.
 * Returns an error if any asset is not a simple SPL hold (pNFT/Core/cNFT need the special path).
 */
export async function sendOwlSendSplNftBatch(params: {
  connection: Connection
  owner: PublicKey
  sendTransaction: WalletSendTransactionFn
  lines: OwlSendLine[]
  onPhase?: (phase: OwlSendSendPhase) => void
}): Promise<OwlSendBatchResult> {
  const { connection, owner, sendTransaction, lines, onPhase } = params
  if (lines.length < 1) return { ok: false, error: 'Nothing to send in this batch.' }
  if (lines.length > OWL_SEND_MAX_PER_TX) {
    return {
      ok: false,
      error: `This batch has ${lines.length} NFTs — max ${OWL_SEND_MAX_PER_TX} per approval.`,
    }
  }

  onPhase?.('building')

  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlSendFeeLamportsForCount(lines.length)
  if (feeLamports > 0 && !treasury) {
    return {
      ok: false,
      error: 'OwlSend fee treasury is not configured (NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET).',
    }
  }

  const tx = new Transaction()
  let newAtaCount = 0
  const failedMints: string[] = []

  for (const line of lines) {
    let mintPk: PublicKey
    let recipientPk: PublicKey
    try {
      mintPk = new PublicKey(line.mint.trim())
      recipientPk = new PublicKey(line.recipient.trim())
    } catch {
      failedMints.push(line.mint)
      return { ok: false, error: `Invalid mint or recipient for ${line.name ?? line.mint}.`, failedMints }
    }

    const holder = await resolveHolder(connection, mintPk, owner, line.tokenAccount)
    if (!holder) {
      failedMints.push(line.mint)
      return {
        ok: false,
        error: `Could not find a transferable SPL token account for ${line.name ?? line.mint.slice(0, 8)}. Compressed / Core / pNFTs may need a single-NFT send.`,
        failedMints,
      }
    }

    const destAta = await getAssociatedTokenAddress(
      mintPk,
      recipientPk,
      false,
      holder.tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    try {
      await getAccount(connection, destAta, 'confirmed', holder.tokenProgram)
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          owner,
          destAta,
          recipientPk,
          mintPk,
          holder.tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
      newAtaCount += 1
    }

    tx.add(
      createTransferInstruction(
        holder.tokenAccount,
        destAta,
        owner,
        1n,
        [],
        holder.tokenProgram
      )
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
    onPhase?.('approving')
    const signature = await sendTransaction(tx, connection, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    })
    onPhase?.('confirming')
    await confirmSignatureSuccessOnChain(
      connection,
      signature,
      OWL_SEND_CONFIRM_TIMEOUT_MS,
      OWL_SEND_CONFIRM_TIMEOUT_HINT
    )
    return { ok: true, signature, newAtaCount }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/too large|versionedtransaction too large|transaction too large/i.test(msg)) {
      return {
        ok: false,
        error:
          'This batch does not fit in one Solana transaction (often when many new token accounts are created). Remove an NFT or send to wallets that already hold that collection, then retry.',
        failedMints: lines.map((l) => l.mint),
      }
    }
    return { ok: false, error: msg || 'Wallet rejected or send failed.', failedMints: lines.map((l) => l.mint) }
  }
}
