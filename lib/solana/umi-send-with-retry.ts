import bs58 from 'bs58'
import { Connection } from '@solana/web3.js'
import {
  transactionBuilder,
  type Transaction,
  type TransactionBuilder,
  type TransactionSignature,
  type Umi,
} from '@metaplex-foundation/umi'
import { setComputeUnitPrice } from '@metaplex-foundation/mpl-toolbox'

import { isBlockhashOrTxExpiryError } from '@/lib/solana/tx-expiry-patterns'
import { extractTxSignatureFromUnknownError } from '@/lib/solana/recover-candy-machine-mint'

const DEFAULT_PRIORITY_MICROLAMPORTS = 10_000
const DEFAULT_RESEND_MS = 2_000
const BLOCKHASH_POLL_MS = 400

export function owlCenterDeployPriorityMicroLamports(): number {
  const raw = process.env.OWL_CENTER_DEPLOY_PRIORITY_MICROLAMPORTS?.trim()
  if (!raw) return DEFAULT_PRIORITY_MICROLAMPORTS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PRIORITY_MICROLAMPORTS
  return Math.floor(n)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rawSignatureFromSignedTx(tx: Transaction): TransactionSignature {
  const sig = tx.signatures[0]
  if (!sig) throw new Error('Signed transaction missing signature')
  return sig as TransactionSignature
}

/** Expects raw signature bytes (UMI TransactionSignature), not base58. */
export async function signatureSucceededOnChain(
  umi: Umi,
  signature: TransactionSignature
): Promise<boolean> {
  try {
    const statuses = await umi.rpc.getSignatureStatuses([signature])
    const st = statuses[0]
    if (st?.error) return false
    if (st?.commitment === 'confirmed' || st?.commitment === 'finalized') return true
  } catch (e) {
    console.error(
      '[sendAndConfirmUmiWithRetry] getSignatureStatuses failed for',
      bs58.encode(signature),
      e
    )
  }
  try {
    const tx = await umi.rpc.getTransaction(signature, {
      commitment: 'confirmed',
    })
    if (!tx) return false
    return !tx.meta?.err
  } catch (e) {
    console.error(
      '[sendAndConfirmUmiWithRetry] getTransaction failed for',
      bs58.encode(signature),
      e
    )
    return false
  }
}

export type SendAndConfirmUmiWithRetryOptions = {
  label: string
  attempts?: number
  resendIntervalMs?: number
  priorityMicroLamports?: number
  /** Wall-clock cap for one confirm loop (e.g. remaining deploy time budget). */
  maxConfirmMs?: number
  /** Before retrying, treat existing on-chain account as success (idempotent create). */
  accountAlreadyCreated?: () => Promise<boolean>
}

/**
 * UMI send with fresh blockhash per attempt, priority fee, resend polling,
 * and post-expiry signature lookup before retrying.
 */
export async function sendAndConfirmUmiWithRetry(
  umi: Umi,
  builder: TransactionBuilder,
  options: SendAndConfirmUmiWithRetryOptions
): Promise<{ signature: string }> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const priority = options.priorityMicroLamports ?? owlCenterDeployPriorityMicroLamports()
  const resendMs = Math.max(500, options.resendIntervalMs ?? DEFAULT_RESEND_MS)

  let lastError: unknown = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1 && options.accountAlreadyCreated) {
      try {
        if (await options.accountAlreadyCreated()) {
          return { signature: `already-created:${options.label}` }
        }
      } catch {
        /* proceed with retry */
      }
    }

    let blockhash = ''
    let lastValidBlockHeight = 0
    try {
      const latest = await umi.rpc.getLatestBlockhash({ commitment: 'confirmed' })
      blockhash = latest.blockhash
      lastValidBlockHeight = Number(latest.lastValidBlockHeight)
    } catch (e) {
      lastError = e
      continue
    }

    let prepared = builder
    if (priority > 0) {
      prepared = transactionBuilder()
        .add(setComputeUnitPrice(umi, { microLamports: priority }))
        .add(builder)
    }

    let signed: Transaction
    try {
      signed = await prepared.setBlockhash(blockhash).buildAndSign(umi)
    } catch (e) {
      lastError = e
      continue
    }

    const signature = rawSignatureFromSignedTx(signed)
    const signatureBase58 = bs58.encode(signature)
    const resend = async () => {
      await umi.rpc.sendTransaction(signed, { skipPreflight: false })
    }

    try {
      await resend()
    } catch (e) {
      lastError = e
      extractTxSignatureFromUnknownError(e)
    }

    let lastResendAt = Date.now()
    const connection = new Connection(umi.rpc.getEndpoint(), 'confirmed')
    const confirmStartedAt = Date.now()
    const maxConfirmMs = options.maxConfirmMs
    let confirmed = false
    while (true) {
      if (maxConfirmMs != null && Date.now() - confirmStartedAt >= maxConfirmMs) break

      if (await signatureSucceededOnChain(umi, signature)) {
        confirmed = true
        break
      }

      const height = await connection.getBlockHeight('confirmed')
      if (height > lastValidBlockHeight) break

      if (Date.now() - lastResendAt >= resendMs) {
        lastResendAt = Date.now()
        try {
          await resend()
        } catch (e) {
          lastError = lastError ?? e
        }
      }

      await sleep(BLOCKHASH_POLL_MS)
    }

    if (confirmed) {
      return { signature: signatureBase58 }
    }

    if (await signatureSucceededOnChain(umi, signature)) {
      return { signature: signatureBase58 }
    }

    lastError = new Error(
      `${options.label}: signature ${signatureBase58.slice(0, 8)}… not confirmed before block height ${lastValidBlockHeight}`
    )
    if (!isBlockhashOrTxExpiryError(lastError)) {
      lastError = new Error(`${options.label}: transaction expired (block height exceeded)`)
    }
  }

  if (lastError instanceof Error) throw lastError
  throw new Error(`${options.label}: send failed after ${attempts} attempts`)
}
