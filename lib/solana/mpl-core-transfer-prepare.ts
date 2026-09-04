/**
 * Server-side prepare for MPL Core OwlSend transfers.
 * Browser RPC often fails with NetworkError on fetchAsset; private SOLANA_RPC_URL builds the tx.
 */

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createNoopSigner,
  lamports,
  publicKey,
  signerIdentity,
  type TransactionBuilder,
  type Umi,
} from '@metaplex-foundation/umi'
import { fetchAsset, transferV1 } from '@metaplex-foundation/mpl-core'
import { transferSol } from '@metaplex-foundation/mpl-toolbox'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import {
  assetOwnerAddress,
  readMplCoreFreezeDelegate,
} from '@/lib/solana/mpl-core-nest-lock'
import { isMplCoreWrongAccountTypeError } from '@/lib/solana/mpl-core-transfer-errors'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { withSolanaRpcRetry } from '@/lib/solana/rpc-retry'

export type PreparedMplCoreTransfer =
  | {
      status: 'ready'
      mint: string
      serializedBase64: string
      blockhash: string
      lastValidBlockHeight: number
      name?: string | null
    }
  | {
      status: 'blocked'
      mint: string
      reason: 'not_owner' | 'owner_frozen' | 'other_frozen' | 'not_core'
      detail?: string
    }
  | { status: 'error'; mint: string; error: string }

function collectionForAsset(assetAccount: any) {
  return assetAccount?.updateAuthority?.type === 'Collection'
    ? assetAccount.updateAuthority.address
    : undefined
}

function createPrepareUmi(endpoint: string, ownerWallet: string): Umi {
  return (createUmi as any)(endpoint).use(
    signerIdentity(createNoopSigner(publicKey(ownerWallet)))
  ) as Umi
}

function appendFee(
  umi: Pick<Umi, 'identity' | 'programs'>,
  builder: TransactionBuilder,
  feeLamports: number | undefined,
  feeTreasury: string | null | undefined
): TransactionBuilder {
  if (!feeLamports || feeLamports <= 0 || !feeTreasury?.trim()) return builder
  return builder.add(
    transferSol(umi, {
      destination: publicKey(feeTreasury.trim()),
      amount: lamports(Math.round(feeLamports)),
    })
  )
}

/**
 * Build one unsigned VersionedTransaction: Core transferV1 (+ optional Owl fee).
 */
export async function prepareMplCoreTransferTransaction(params: {
  connection?: Connection | null
  ownerWallet: string
  assetId: string
  recipient: string
  feeLamports?: number
  feeTreasury?: string | null
}): Promise<PreparedMplCoreTransfer> {
  const mint = params.assetId.trim()
  const ownerWallet = params.ownerWallet.trim()
  const recipient = params.recipient.trim()
  if (!mint) return { status: 'error', mint: '', error: 'NFT asset id is required.' }
  if (!ownerWallet) return { status: 'error', mint, error: 'Owner wallet is required.' }
  if (!recipient) return { status: 'error', mint, error: 'Recipient wallet is required.' }

  const endpoint =
    ((params.connection as any)?.rpcEndpoint as string | undefined)?.trim() ||
    ((params.connection as any)?._rpcEndpoint as string | undefined)?.trim() ||
    resolveServerSolanaRpcUrl()

  try {
    const umi = createPrepareUmi(endpoint, ownerWallet)
    const asset = publicKey(mint)
    const assetAccount: any = await withSolanaRpcRetry(
      () => fetchAsset(umi as any, asset),
      { retries: 4, baseDelayMs: 600 }
    )

    if (assetOwnerAddress(assetAccount) !== ownerWallet) {
      return { status: 'blocked', mint, reason: 'not_owner' }
    }

    const fd = readMplCoreFreezeDelegate(assetAccount)
    if (fd?.frozen) {
      if (fd.authorityType === 'Owner') {
        return { status: 'blocked', mint, reason: 'owner_frozen' }
      }
      return {
        status: 'blocked',
        mint,
        reason: 'other_frozen',
        detail: fd.authorityType ?? undefined,
      }
    }

    const maybeCollection = collectionForAsset(assetAccount)
    let builder: TransactionBuilder = transferV1(umi as any, {
      asset,
      newOwner: publicKey(recipient),
      ...(maybeCollection ? { collection: maybeCollection } : {}),
    } as any) as TransactionBuilder

    builder = appendFee(umi, builder, params.feeLamports, params.feeTreasury)

    const built = await withSolanaRpcRetry(
      () => builder.buildWithLatestBlockhash(umi),
      { retries: 4, baseDelayMs: 600 }
    )
    const web3Tx = toWeb3JsTransaction(built)
    const serializedBase64 = Buffer.from(web3Tx.serialize()).toString('base64')
    const message = web3Tx.message as { recentBlockhash?: string }
    let blockhash = typeof message.recentBlockhash === 'string' ? message.recentBlockhash : ''
    let lastValidBlockHeight = 0
    if (params.connection) {
      try {
        const latest = await withSolanaRpcRetry(
          () => params.connection!.getLatestBlockhash('confirmed'),
          { retries: 3, baseDelayMs: 500 }
        )
        if (!blockhash) blockhash = latest.blockhash
        lastValidBlockHeight = latest.lastValidBlockHeight
      } catch {
        /* client confirm can refresh */
      }
    }

    return {
      status: 'ready',
      mint,
      serializedBase64,
      blockhash,
      lastValidBlockHeight,
      name: typeof assetAccount?.name === 'string' ? assetAccount.name : null,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isMplCoreWrongAccountTypeError(msg)) {
      return { status: 'blocked', mint, reason: 'not_core', detail: msg }
    }
    return { status: 'error', mint, error: msg || 'Failed to prepare Core transfer.' }
  }
}
