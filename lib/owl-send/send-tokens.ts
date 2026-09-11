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
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import { withSolanaRpcRetry } from '@/lib/solana/rpc-retry'
import {
  OWL_SEND_CONFIRM_TIMEOUT_HINT,
  OWL_SEND_CONFIRM_TIMEOUT_MS,
} from '@/lib/owl-send/confirm'
import { prependOwlSendComputeBudget } from '@/lib/owl-send/compute-budget'
import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import { OWL_SEND_MAX_PER_TX, OWL_SEND_MAX_PER_TX_TOKEN } from '@/lib/owl-send/constants'
import { isOwlSendRpcNetworkError } from '@/lib/owl-send/rpc-network-error'
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

/** RPC getMultipleAccountsInfo chunk size (public endpoints often cap near 100). */
const OWL_SEND_TOKEN_ACCOUNT_INFO_CHUNK = 100

const OWL_SEND_TOKEN_RPC_RETRY = { retries: 4, baseDelayMs: 400 } as const

function owlSendTokenRpcFailureMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (
    isOwlSendRpcNetworkError(raw) ||
    /failed to get (?:recent|latest) blockhash/i.test(raw)
  ) {
    return (
      'Solana RPC dropped while preparing this approval (blockhash / account read). ' +
      'Wait a few seconds and tap Retry — your list and progress are kept. ' +
      'On mobile, try Wi‑Fi or switch networks if it keeps failing.'
    )
  }
  return raw || fallback
}

async function getMultipleAccountsInfoChunked(
  connection: Connection,
  keys: PublicKey[],
  commitment: 'confirmed' | 'processed' = 'confirmed'
) {
  const out: Awaited<ReturnType<Connection['getMultipleAccountsInfo']>> = []
  for (let i = 0; i < keys.length; i += OWL_SEND_TOKEN_ACCOUNT_INFO_CHUNK) {
    const slice = keys.slice(i, i + OWL_SEND_TOKEN_ACCOUNT_INFO_CHUNK)
    const infos = await withSolanaRpcRetry(
      () => connection.getMultipleAccountsInfo(slice, commitment),
      OWL_SEND_TOKEN_RPC_RETRY
    )
    out.push(...infos)
  }
  return out
}

/**
 * Probe whether each recipient already has an ATA for `mint`.
 * Missing / RPC errors ⇒ treat as needs create (conservative packing).
 * Chunks RPC reads so 600+ wallet airdrops do not blow public endpoint limits.
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
    (await withSolanaRpcRetry(
      () => resolveMintTokenProgram(params.connection, mintPk, 'confirmed'),
      OWL_SEND_TOKEN_RPC_RETRY
    )) ??
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

  const infos = await getMultipleAccountsInfoChunked(
    params.connection,
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
  /**
   * Reuse a blockhash across a sign-all window so we do not hammer RPC
   * (and so Phantom does not call getLatestBlockhash itself during approve).
   */
  recentBlockhash?: string
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

  const resolved: Array<{
    line: OwlSendTokenLine
    recipientPk: PublicKey
    mintPk: PublicKey
    source: PublicKey
    destAta: PublicKey
    tokenProgram: PublicKey
  }> = []

  // Scatter is one mint; resolve the token program once.
  let sharedTokenProgram: PublicKey | null = null
  try {
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
        return {
          ok: false,
          error: `Recipient wallet is not a valid Solana address: ${destRaw.slice(0, 8)}…`,
        }
      }

      const mintPk = new PublicKey(line.mint)
      const source = new PublicKey(line.tokenAccount)
      if (!sharedTokenProgram || resolved.length === 0 || resolved[0]!.mintPk.equals(mintPk) === false) {
        sharedTokenProgram =
          (await withSolanaRpcRetry(
            () => resolveMintTokenProgram(connection, mintPk, 'confirmed'),
            OWL_SEND_TOKEN_RPC_RETRY
          )) ?? TOKEN_PROGRAM_ID
      }
      const tokenProgram = sharedTokenProgram
      const destAta = getAssociatedTokenAddressSync(
        mintPk,
        recipientPk,
        false,
        tokenProgram,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
      resolved.push({ line, recipientPk, mintPk, source, destAta, tokenProgram })
    }
  } catch (e) {
    return { ok: false, error: owlSendTokenRpcFailureMessage(e, 'Could not prepare token accounts.') }
  }

  let destInfos: Awaited<ReturnType<Connection['getMultipleAccountsInfo']>>
  try {
    destInfos = await getMultipleAccountsInfoChunked(
      connection,
      resolved.map((r) => r.destAta),
      'processed'
    )
  } catch (e) {
    return { ok: false, error: owlSendTokenRpcFailureMessage(e, 'Could not read destination token accounts.') }
  }

  const tx = new Transaction()
  let newAtaCount = 0

  for (let i = 0; i < resolved.length; i++) {
    const r = resolved[i]!
    const info = destInfos[i]
    const hasAta =
      !!info &&
      (info.owner.equals(TOKEN_PROGRAM_ID) || info.owner.equals(r.tokenProgram))

    if (!hasAta) {
      tx.add(
        createAssociatedTokenAccountInstruction(
          owner,
          r.destAta,
          r.recipientPk,
          r.mintPk,
          r.tokenProgram,
          ASSOCIATED_TOKEN_PROGRAM_ID
        )
      )
      newAtaCount += 1
    }
    tx.add(
      createTransferInstruction(
        r.source,
        r.destAta,
        owner,
        r.line.amountRaw,
        [],
        r.tokenProgram
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

  prependOwlSendComputeBudget(tx)
  tx.feePayer = owner

  // Attach blockhash before wallet approve — same pattern as NFT OwlSend.
  // Without this, Phantom/adapters call getLatestBlockhash themselves and often
  // surface "failed to get recent blockhash: TypeError: Failed to fetch" on large airdrops.
  try {
    const blockhash =
      params.recentBlockhash ??
      (
        await withSolanaRpcRetry(
          () => connection.getLatestBlockhash('processed'),
          OWL_SEND_TOKEN_RPC_RETRY
        )
      ).blockhash
    tx.recentBlockhash = blockhash
  } catch (e) {
    return { ok: false, error: owlSendTokenRpcFailureMessage(e, 'Could not fetch a recent blockhash.') }
  }

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
  recentBlockhash?: string
}): Promise<OwlSendBatchResult> {
  const built = await buildOwlSendTokenTransaction({
    connection: params.connection,
    owner: params.owner,
    recipient: params.recipient,
    lines: params.lines,
    feeDiscountBps: params.feeDiscountBps,
    maxPerTx: params.maxPerTx,
    recentBlockhash: params.recentBlockhash,
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
    return { ok: false, error: owlSendTokenRpcFailureMessage(e, 'Token send failed.') }
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
