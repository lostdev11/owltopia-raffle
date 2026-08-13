'use client'

import type { WalletAdapter } from '@solana/wallet-adapter-base'
import type { Connection, PublicKey, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  getPhantomInjectedProviderForPublicKey,
  walletAdapterIsPhantom,
} from '@/lib/solana/phantom-sign-and-send-transaction'
import { assertTransactionSimulatesClean } from '@/lib/solana/phantom-presimulate'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import {
  OWL_SEND_CONFIRM_TIMEOUT_HINT,
  OWL_SEND_CONFIRM_TIMEOUT_MS,
} from '@/lib/owl-send/confirm'
import { owlSendLineNeedsSpecialPath } from '@/lib/owl-send/send-batch'
import type { OwlSendLine } from '@/lib/owl-send/batch'

export type OwlSendSignAllBuilt = {
  tx: Transaction
  lines: OwlSendLine[]
  newAtaCount: number
}

type SignAllAdapter = WalletAdapter & {
  signAllTransactions?: (transactions: Transaction[]) => Promise<Transaction[]>
}

/** True when the wallet can sign several OwlSend txs in one sheet. */
export function walletSupportsOwlSendSignAll(adapter: WalletAdapter | null | undefined): boolean {
  if (!adapter) return false
  if (walletAdapterIsPhantom(adapter)) return true
  return typeof (adapter as SignAllAdapter).signAllTransactions === 'function'
}

/** Classic SPL batches only — cNFT / pNFT / Core still need one-at-a-time. */
export function owlSendBatchesCanSignAll(batches: OwlSendLine[][]): boolean {
  if (batches.length < 2) return false
  return batches.every((batch) => batch.length > 0 && !batch.some(owlSendLineNeedsSpecialPath))
}

function normalizeSignature(sig: string | Uint8Array): string {
  if (typeof sig === 'string') return sig
  return bs58.encode(sig)
}

/**
 * One wallet sheet for every built batch. Does **not** fall back to sequential
 * popups — if the bundle fails, the caller shows Retry.
 */
export async function sendOwlSendSignedBatchGroup(params: {
  connection: Connection
  owner: PublicKey
  walletAdapter: WalletAdapter | null
  built: OwlSendSignAllBuilt[]
  onPhase?: (phase: 'approving' | 'confirming') => void
}): Promise<Array<{ ok: true; signature: string; newAtaCount: number; sentMints: string[] }>> {
  const { connection, owner, walletAdapter, built } = params
  if (built.length < 1) return []

  for (const row of built) {
    await assertTransactionSimulatesClean(connection, row.tx, {
      failMessagePrefix: 'This send would fail on-chain before wallet approval. ',
      ignoreRpcErrors: true,
    })
  }

  params.onPhase?.('approving')
  const signatures: string[] = []

  const phantom =
    walletAdapter && walletAdapterIsPhantom(walletAdapter)
      ? getPhantomInjectedProviderForPublicKey(owner)
      : null

  if (phantom?.signAndSendAllTransactions) {
    const { signatures: raw } = await phantom.signAndSendAllTransactions(
      built.map((b) => b.tx),
      { skipPreflight: true, preflightCommitment: 'processed', maxRetries: 3 }
    )
    for (const sig of raw) signatures.push(normalizeSignature(sig))
  } else {
    const signAll = (walletAdapter as SignAllAdapter | null)?.signAllTransactions
    if (!signAll) {
      throw new Error('This wallet cannot approve all batches in one sheet. Retry to send them one by one.')
    }
    const signed = await signAll(built.map((b) => b.tx))
    for (const tx of signed) {
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: true,
        preflightCommitment: 'processed',
        maxRetries: 3,
      })
      signatures.push(sig)
    }
  }

  params.onPhase?.('confirming')
  const out: Array<{ ok: true; signature: string; newAtaCount: number; sentMints: string[] }> = []
  for (let i = 0; i < built.length; i++) {
    const signature = signatures[i]
    if (!signature) {
      throw new Error(`Wallet did not return a signature for approval ${i + 1} of ${built.length}.`)
    }
    await confirmSignatureSuccessOnChain(
      connection,
      signature,
      OWL_SEND_CONFIRM_TIMEOUT_MS,
      OWL_SEND_CONFIRM_TIMEOUT_HINT
    )
    out.push({
      ok: true,
      signature,
      newAtaCount: built[i]!.newAtaCount,
      sentMints: built[i]!.lines.map((l) => l.mint),
    })
  }
  return out
}
