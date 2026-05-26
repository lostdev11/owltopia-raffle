'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey, transactionBuilder } from '@metaplex-foundation/umi'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { addPlugin, fetchAsset, updatePlugin } from '@metaplex-foundation/mpl-core'
import bs58 from 'bs58'
import {
  isMplCoreNestingLockHeld,
  mplCoreNestCanServerRefreeze,
  mplCoreNestNeedsWalletRelock,
  readMplCoreFreezeDelegate,
} from '@/lib/solana/mpl-core-nest-lock'
import { isMplCoreNoApprovalsError } from '@/lib/solana/mpl-core-transfer-errors'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'

type MplCoreFreezeWalletBase = {
  connection: Connection
  wallet: any
  delegateAddress: string
}

type AddMplCoreFreezeDelegateArgs = MplCoreFreezeWalletBase & {
  assetId: string
}

/** Max Owltopia coins per wallet transaction (Solana tx size / compute). */
export const NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX = 20

/** Max coins per Confirm nest click and per Select all (run in batches for larger flocks). */
export const NESTING_NFT_STAKE_MAX_PER_RUN = NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX

export function capNftStakeAssetIds(assetIds: string[]): string[] {
  return assetIds.slice(0, NESTING_NFT_STAKE_MAX_PER_RUN)
}

export function chunkNftFreezeAssetIds(
  assetIds: string[],
  maxPerTx: number = NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX
): string[][] {
  const uniq = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))]
  const chunks: string[][] = []
  for (let i = 0; i < uniq.length; i += maxPerTx) {
    chunks.push(uniq.slice(i, i + maxPerTx))
  }
  return chunks
}

function signatureToString(result: any): string {
  const sig = result?.signature ?? result
  if (sig instanceof Uint8Array) return bs58.encode(sig)
  if (Array.isArray(sig)) return bs58.encode(Uint8Array.from(sig))
  return String(sig)
}

function mplCoreFreezeDelegatePlugin(delegatePublicKey: ReturnType<typeof publicKey>) {
  return {
    type: 'FreezeDelegate' as const,
    frozen: true,
    authority: { type: 'Address' as const, address: delegatePublicKey },
  }
}

function collectionForAsset(assetAccount: any) {
  return assetAccount?.updateAuthority?.type === 'Collection'
    ? assetAccount.updateAuthority.address
    : undefined
}

/**
 * One wallet transaction to re-lock multiple Owl Nest coins (Owner FreezeDelegate → frozen: true).
 */
export async function batchRelockMplCoreNestAssetsInWallet({
  connection,
  wallet,
  assetIds,
  delegateAddress,
}: MplCoreFreezeWalletBase & { assetIds: string[] }): Promise<string | null> {
  const pubkey = wallet?.publicKey ?? wallet?.adapter?.publicKey
  if (!pubkey) {
    throw new Error('Wallet adapter not ready for MPL Core freeze lock.')
  }
  const ownerWallet = pubkey.toString?.() ? String(pubkey) : String(pubkey)
  const delegate = delegateAddress.trim()
  if (!delegate) {
    throw new Error('Freeze delegate address is not configured.')
  }

  const endpoint = resolveMetaplexClientRpcUrl(connection)
  const umi: any = (createUmi as any)(endpoint).use(walletAdapterIdentity(wallet as any))
  const delegatePublicKey = publicKey(delegate)

  let tx = transactionBuilder()
  let instructionCount = 0

  for (const rawId of [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))]) {
    const asset = publicKey(rawId)
    const assetAccount: any = await fetchAsset(umi as any, asset)
    const maybeCollection = collectionForAsset(assetAccount)
    const ixBase = {
      asset,
      ...(maybeCollection ? { collection: maybeCollection } : {}),
    }

    if (isMplCoreNestingLockHeld({ asset: assetAccount, nestingDelegateAddress: delegate, ownerWallet })) {
      continue
    }

    const existing = readMplCoreFreezeDelegate(assetAccount)
    const needsRelock = mplCoreNestNeedsWalletRelock({
      asset: assetAccount,
      nestingDelegateAddress: delegate,
      ownerWallet,
    })

    if (mplCoreNestCanServerRefreeze({ asset: assetAccount, nestingDelegateAddress: delegate })) {
      continue
    }

    if (existing && !needsRelock) {
      throw new Error(
        `Owltopia coin ${rawId.slice(0, 6)}… has a freeze lock this wallet cannot update. Contact support.`
      )
    }

    if (existing) {
      tx = tx.add(
        updatePlugin(umi as any, {
          ...ixBase,
          plugin: { type: 'FreezeDelegate', frozen: true },
        } as any)
      )
    } else {
      tx = tx.add(
        addPlugin(umi as any, {
          ...ixBase,
          plugin: mplCoreFreezeDelegatePlugin(delegatePublicKey),
        } as any)
      )
    }
    instructionCount += 1
  }

  if (instructionCount === 0) return null

  try {
    const result = await tx.sendAndConfirm(umi as any)
    return signatureToString(result)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (isMplCoreNoApprovalsError(detail)) {
      throw new Error(
        'Collection plugins blocked re-locking your Owltopia coins (Metaplex error 0x1a). Contact support with your wallet address.'
      )
    }
    throw e
  }
}

/**
 * Owner-signed MPL Core nest lock.
 * Returns `null` when already frozen (Owner or nesting delegate).
 * Uses updatePlugin (frozen only) when a FreezeDelegate already exists — never RemovePlugin via freezeAsset.
 */
export async function addMplCoreFreezeDelegate({
  connection,
  wallet,
  assetId,
  delegateAddress,
}: AddMplCoreFreezeDelegateArgs): Promise<string | null> {
  const pubkey = wallet?.publicKey ?? wallet?.adapter?.publicKey
  if (!pubkey) {
    throw new Error('Wallet adapter not ready for MPL Core freeze lock.')
  }
  const ownerWallet = pubkey.toString?.() ? String(pubkey) : String(pubkey)
  const delegate = delegateAddress.trim()
  if (!delegate) {
    throw new Error('Freeze delegate address is not configured.')
  }

  const endpoint = resolveMetaplexClientRpcUrl(connection)
  const umi: any = (createUmi as any)(endpoint).use(walletAdapterIdentity(wallet as any))
  const asset = publicKey(assetId)
  const delegatePublicKey = publicKey(delegate)
  const assetAccount: any = await fetchAsset(umi as any, asset)

  if (isMplCoreNestingLockHeld({ asset: assetAccount, nestingDelegateAddress: delegate, ownerWallet })) {
    return null
  }

  const maybeCollection: any =
    assetAccount?.updateAuthority?.type === 'Collection'
      ? assetAccount.updateAuthority.address
      : undefined

  const ixBase = {
    asset,
    ...(maybeCollection ? { collection: maybeCollection } : {}),
  }

  const existing = readMplCoreFreezeDelegate(assetAccount)
  const needsRelock = mplCoreNestNeedsWalletRelock({
    asset: assetAccount,
    nestingDelegateAddress: delegate,
    ownerWallet,
  })

  if (mplCoreNestCanServerRefreeze({ asset: assetAccount, nestingDelegateAddress: delegate })) {
    return null
  }

  if (existing && !needsRelock) {
    throw new Error(
      'This Owltopia coin has a freeze lock controlled by a different authority. Contact Owltopia support with the coin mint address.'
    )
  }

  try {
    const builder = existing
      ? updatePlugin(umi as any, {
          ...ixBase,
          plugin: { type: 'FreezeDelegate', frozen: true },
        } as any)
      : addPlugin(umi as any, {
          ...ixBase,
          plugin: mplCoreFreezeDelegatePlugin(delegatePublicKey),
        } as any)
    const result = await builder.sendAndConfirm(umi as any)
    return signatureToString(result)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (isMplCoreNoApprovalsError(detail)) {
      throw new Error(
        'This Owltopia coin has collection plugins that blocked updating the nest lock (Metaplex error 0x1a). ' +
          'Confirm the coin is not listed for sale, or contact Owltopia support with the mint address.'
      )
    }
    throw e
  }
}
