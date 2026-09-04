/**
 * Server-side prepare for holder wallet thaw of MPL Core Owner FreezeDelegate.
 * Uses the site's private RPC so browser "Failed to fetch" / public RPC flakes
 * do not block building `updatePlugin(frozen:false)`.
 */

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createNoopSigner,
  publicKey,
  signerIdentity,
  type Umi,
} from '@metaplex-foundation/umi'
import { fetchAsset, updatePlugin } from '@metaplex-foundation/mpl-core'
import { toWeb3JsTransaction } from '@metaplex-foundation/umi-web3js-adapters'
import {
  assetOwnerAddress,
  readMplCoreFreezeDelegate,
} from '@/lib/solana/mpl-core-nest-lock'
import { isMplCoreWrongAccountTypeError } from '@/lib/solana/mpl-core-transfer-errors'
import { resolveServerSolanaRpcUrl } from '@/lib/solana-rpc-url'
import { withSolanaRpcRetry } from '@/lib/solana/rpc-retry'

export type PreparedMplCoreOwnerThaw =
  | {
      status: 'ready'
      mint: string
      serializedBase64: string
      blockhash: string
      lastValidBlockHeight: number
    }
  | {
      status: 'skipped'
      mint: string
      reason: 'already_thawed' | 'not_core' | 'not_owner' | 'not_wallet_freeze'
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

/**
 * Build one unsigned VersionedTransaction for Owner FreezeDelegate thaw.
 * Caller must have the holder sign+send (server cannot thaw Owner locks).
 */
export async function prepareMplCoreOwnerThawTransaction(params: {
  /** Prefer server Connection (`getSolanaConnection`). Falls back to env RPC URL. */
  connection?: Connection | null
  ownerWallet: string
  assetId: string
}): Promise<PreparedMplCoreOwnerThaw> {
  const mint = params.assetId.trim()
  const ownerWallet = params.ownerWallet.trim()
  if (!mint) return { status: 'error', mint: '', error: 'NFT asset id is required.' }
  if (!ownerWallet) return { status: 'error', mint, error: 'Owner wallet is required.' }

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
      return { status: 'skipped', mint, reason: 'not_owner' }
    }

    const fd = readMplCoreFreezeDelegate(assetAccount)
    if (!fd?.frozen) {
      return { status: 'skipped', mint, reason: 'already_thawed' }
    }
    if (fd.authorityType !== 'Owner') {
      return {
        status: 'skipped',
        mint,
        reason: 'not_wallet_freeze',
        detail: fd.authorityType ?? undefined,
      }
    }

    const maybeCollection = collectionForAsset(assetAccount)
    const builder = updatePlugin(umi as any, {
      asset,
      ...(maybeCollection ? { collection: maybeCollection } : {}),
      plugin: { type: 'FreezeDelegate', frozen: false },
    } as any)

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
        /* confirm on client can refresh blockhash */
      }
    }

    return {
      status: 'ready',
      mint,
      serializedBase64,
      blockhash,
      lastValidBlockHeight,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (isMplCoreWrongAccountTypeError(msg)) {
      return { status: 'skipped', mint, reason: 'not_core', detail: msg }
    }
    return { status: 'error', mint, error: msg || 'Failed to prepare thaw transaction.' }
  }
}

/** Cap per HTTP request — keep at 1 so blockhashes stay fresh across wallet approves. */
export const MPL_CORE_OWNER_THAW_PREPARE_MAX = 1
