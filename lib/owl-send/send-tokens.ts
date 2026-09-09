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
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import {
  OWL_SEND_CONFIRM_TIMEOUT_HINT,
  OWL_SEND_CONFIRM_TIMEOUT_MS,
} from '@/lib/owl-send/confirm'
import { prependOwlSendComputeBudget } from '@/lib/owl-send/compute-budget'
import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import { OWL_SEND_MAX_PER_TX, OWL_SEND_MAX_PER_TX_TOKEN } from '@/lib/owl-send/constants'
import { resolveMintTokenProgram } from '@/lib/owl-send/resolve-spl-holder'
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

export type OwlSendTokenBuildResult =
  | { ok: true; tx: Transaction; newAtaCount: number }
  | { ok: false; error: string }

/**
 * Probe whether each recipient already has an ATA for `mint`.
 * Missing / RPC errors ⇒ treat as needs create (conservative packing).
 */
export async function probeOwlSendTokenDestNeedsCreateAta(params: {
  connection: Connection
  mint: string
  recipients: string[]
  /** When known from a prior mint resolve; otherwise probed. */
  tokenProgram?: PublicKey
}): Promise<boolean[]> {
  const mintPk = new PublicKey(params.mint)
  const tokenProgram =
    params.tokenProgram ??
    (await resolveMintTokenProgram(params.connection, mintPk, 'confirmed')) ??
    TOKEN_PROGRAM_ID

  const atas = params.recipients.map((r) => {
    try {
      return getAssociatedTokenAddressSync(
        mintPk,
        new PublicKey(r.trim()),
        false,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    } catch {
      return null
    }
  })

  const infos = await params.connection.getMultipleAccountsInfo(
    atas.map((a) => a ?? PublicKey.default),
    'confirmed'
  )

  return atas.map((ata, i) => {
    if (!ata) return true
    const info = infos[i]
    return !(info && info.owner.equals(tokenProgram))
  })
}

/** Build (do not send) fungible token lines + Owl fee in one transaction. */
export async function buildOwlSendTokenTransaction(params: {
  connection: Connection
  owner: PublicKey
  /** Default recipient when a line omits `recipient`. */
  recipient?: string
  lines: OwlSendTokenLine[]
  /** Owltopia holder discount (bps). */
  feeDiscountBps?: number
  /** Cap (scatter uses {@link OWL_SEND_MAX_PER_TX_TOKEN}). */
  maxPerTx?: number
}): Promise<OwlSendTokenBuildResult> {
  const { connection, owner, lines } = params
  const maxPer = params.maxPerTx ?? OWL_SEND_MAX_PER_TX_TOKEN
  if (lines.length < 1) return { ok: false, error: 'Select at least one token amount to send.' }
  if (lines.length > maxPer) {
    return {
      ok: false,
      error: `Max ${maxPer} token lines per approval.`,
    }
  }

  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlSendFeeLamportsForCount(lines.length, params.feeDiscountBps ?? 0)
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
    const tokenProgram =
      (await resolveMintTokenProgram(connection, mintPk, 'confirmed')) ?? TOKEN_PROGRAM_ID
    const destAta = await getAssociatedTokenAddress(
      mintPk,
      recipientPk,
      false,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    try {
      await getAccount(connection, destAta, 'confirmed', tokenProgram)
    } catch {
      tx.add(
        createAssociatedTokenAccountInstruction(
          owner,
          destAta,
          recipientPk,
          mintPk,
          tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
      newAtaCount += 1
    }
    tx.add(
      createTransferInstruction(source, destAta, owner, line.amountRaw, [], tokenProgram)
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

  prependOwlSendComputeBudget(tx)
  return { ok: true, tx, newAtaCount }
}

/** Send fungible token lines + Owl fee in one approval (one or many recipients). */
export async function sendOwlSendTokenLines(params: {
  connection: Connection
  owner: PublicKey
  /** Default recipient when a line omits `recipient`. */
  recipient?: string
  sendTransaction: WalletSendTransactionFn
  lines: OwlSendTokenLine[]
  /** Owltopia holder discount (bps). */
  feeDiscountBps?: number
  maxPerTx?: number
}): Promise<OwlSendBatchResult> {
  const built = await buildOwlSendTokenTransaction({
    connection: params.connection,
    owner: params.owner,
    recipient: params.recipient,
    lines: params.lines,
    feeDiscountBps: params.feeDiscountBps,
    maxPerTx: params.maxPerTx,
  })
  if (!built.ok) return built

  try {
    const signature = await params.sendTransaction(built.tx, params.connection, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    })
    await confirmSignatureSuccessOnChain(
      params.connection,
      signature,
      OWL_SEND_CONFIRM_TIMEOUT_MS,
      OWL_SEND_CONFIRM_TIMEOUT_HINT
    )
    return { ok: true, signature, newAtaCount: built.newAtaCount }
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
  feeDiscountBps?: number
}): Promise<OwlSendBatchResult> {
  return sendOwlSendTokenLines({
    connection: params.connection,
    owner: params.owner,
    recipient: params.recipient,
    sendTransaction: params.sendTransaction,
    lines: params.lines,
    feeDiscountBps: params.feeDiscountBps,
    // Multi-mint send-to-one keeps the classic 5-line cap (more account keys).
    maxPerTx: OWL_SEND_MAX_PER_TX,
  })
}
