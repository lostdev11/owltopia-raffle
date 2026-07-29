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
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { getNftHolderInWallet } from '@/lib/solana/wallet-tokens'
import { HOLDER_LOOKUP_MAX_ATTEMPTS } from '@/lib/solana/holder-lookup-retries'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import { getOwlTransferFeeLamportsForCount } from '@/lib/owl-transfer/fee'
import { OWL_TRANSFER_MAX_PER_TX } from '@/lib/owl-transfer/constants'
import type { OwlTransferLine } from '@/lib/owl-transfer/batch'

export type OwlTransferBatchResult =
  | { ok: true; signature: string; newAtaCount: number }
  | { ok: false; error: string; failedMints?: string[] }

async function resolveHolder(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  hintTokenAccount?: string | null
) {
  if (hintTokenAccount && hintTokenAccount !== mint.toBase58()) {
    try {
      const selectedTokenAccount = new PublicKey(hintTokenAccount)
      const selectedInfo = await connection.getParsedAccountInfo(selectedTokenAccount, 'processed')
      const ownerProgram = selectedInfo.value?.owner
      const isSplProgram = ownerProgram?.equals(TOKEN_PROGRAM_ID) ?? false
      const isToken2022 = ownerProgram?.equals(TOKEN_2022_PROGRAM_ID) ?? false
      const info = (
        selectedInfo.value?.data as { parsed?: { info?: Record<string, unknown> } } | undefined
      )?.parsed?.info
      const selectedMint = typeof info?.mint === 'string' ? info.mint : null
      const amountRaw =
        typeof info?.tokenAmount === 'object' && info?.tokenAmount
          ? (info.tokenAmount as { amount?: unknown }).amount
          : undefined
      const amount =
        typeof amountRaw === 'string'
          ? Number(amountRaw)
          : typeof amountRaw === 'number'
            ? amountRaw
            : 0
      const delegate = typeof info?.delegate === 'string' ? info.delegate : null
      if (selectedMint === mint.toBase58() && amount >= 1 && !delegate) {
        if (isSplProgram) {
          return { tokenProgram: TOKEN_PROGRAM_ID, tokenAccount: selectedTokenAccount }
        }
        if (isToken2022) {
          return { tokenProgram: TOKEN_2022_PROGRAM_ID, tokenAccount: selectedTokenAccount }
        }
      }
    } catch {
      /* fall through */
    }
  }

  for (let attempt = 0; attempt < HOLDER_LOOKUP_MAX_ATTEMPTS; attempt++) {
    const h = await getNftHolderInWallet(connection, mint, owner, 'processed')
    if (h && 'delegated' in h && h.delegated) {
      throw new Error(`NFT ${mint.toBase58().slice(0, 4)}… is staked or delegated — unstake before sending.`)
    }
    if (h && 'tokenProgram' in h && 'tokenAccount' in h) return h
    if (attempt < HOLDER_LOOKUP_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, 700))
    }
  }
  return null
}

/**
 * Send up to 5 classic SPL / Token-2022 NFTs + Owl fee in one wallet approval.
 * Returns an error if any asset is not a simple SPL hold (pNFT/Core/cNFT need the special path).
 */
export async function sendOwlTransferSplNftBatch(params: {
  connection: Connection
  owner: PublicKey
  sendTransaction: WalletSendTransactionFn
  lines: OwlTransferLine[]
}): Promise<OwlTransferBatchResult> {
  const { connection, owner, sendTransaction, lines } = params
  if (lines.length < 1) return { ok: false, error: 'Nothing to send in this batch.' }
  if (lines.length > OWL_TRANSFER_MAX_PER_TX) {
    return {
      ok: false,
      error: `This batch has ${lines.length} NFTs — max ${OWL_TRANSFER_MAX_PER_TX} per approval.`,
    }
  }

  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlTransferFeeLamportsForCount(lines.length)
  if (feeLamports > 0 && !treasury) {
    return {
      ok: false,
      error: 'Owl Transfer fee treasury is not configured (NEXT_PUBLIC_OWL_PLATFORM_FEE_TREASURY_WALLET).',
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
    const signature = await sendTransaction(tx, connection, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    })
    await confirmSignatureSuccessOnChain(connection, signature)
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
