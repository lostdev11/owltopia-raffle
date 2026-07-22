'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createNoopSigner,
  publicKey,
  signerIdentity,
  transactionBuilder,
  type TransactionBuilder,
  type Umi,
} from '@metaplex-foundation/umi'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { addPlugin, fetchAsset, updatePlugin } from '@metaplex-foundation/mpl-core'
import bs58 from 'bs58'
import {
  appendStakingPlatformFeeToUmiBuilder,
  type StakingPlatformFeeUmiTransfer,
} from '@/lib/nesting/staking-platform-fee-umi'
import {
  isMplCoreNestingLockHeld,
  mplCoreNestCanServerRefreeze,
  mplCoreNestNeedsWalletRelock,
  readMplCoreFreezeDelegate,
} from '@/lib/solana/mpl-core-nest-lock'
import { isMplCoreNoApprovalsError } from '@/lib/solana/mpl-core-transfer-errors'
import { assertPhantomUsesWalletSignAndSend } from '@/lib/solana/phantom-safe-umi-send'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'
import {
  sendUmiBuilderViaWalletSignAndSend,
  type WalletSendTransactionFn,
} from '@/lib/solana/send-umi-builder-via-wallet'

type MplCoreFreezeWalletBase = {
  connection: Connection
  wallet: any
  delegateAddress: string
  /**
   * Prefer Phantom `signAndSendTransaction` (via `useSendTransactionForWallet`).
   * Required to clear Blowfish "could be malicious" warnings on nest locks.
   */
  sendTransaction?: WalletSendTransactionFn
}

type AddMplCoreFreezeDelegateArgs = MplCoreFreezeWalletBase & {
  assetId: string
}

/**
 * Max NFTs per wallet transaction.
 * Kept under the Solana size limit with headroom for Phantom Lighthouse guard ixs + nest fee.
 * If a wallet still rejects a full chunk, the UI halves and retries before one-by-one.
 */
export const NESTING_MPL_CORE_FREEZE_WALLET_BATCH_MAX = 12

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

function createNestLockUmi(endpoint: string, ownerWallet: string, walletAdapter: any): Umi {
  // Noop identity so we build *unsigned* txs for Phantom signAndSendTransaction + Lighthouse.
  // Fallback sendAndConfirm still uses walletAdapterIdentity below when sendTransaction is omitted.
  void walletAdapter
  return (createUmi as any)(endpoint).use(
    signerIdentity(createNoopSigner(publicKey(ownerWallet)))
  ) as Umi
}

async function sendNestLockBuilder(params: {
  umi: Umi
  builder: TransactionBuilder
  connection: Connection
  wallet: any
  sendTransaction?: WalletSendTransactionFn
}): Promise<string> {
  assertPhantomUsesWalletSignAndSend({
    wallet: params.wallet,
    sendTransaction: params.sendTransaction,
    action: 'nest lock',
  })
  if (params.sendTransaction) {
    return sendUmiBuilderViaWalletSignAndSend({
      umi: params.umi,
      builder: params.builder,
      connection: params.connection,
      sendTransaction: params.sendTransaction,
    })
  }

  // Legacy fallback (non-Phantom / older callers): UMI wallet-adapter sendAndConfirm.
  const endpoint = resolveMetaplexClientRpcUrl(params.connection)
  const signedUmi: any = (createUmi as any)(endpoint).use(walletAdapterIdentity(params.wallet as any))
  const result = await params.builder.sendAndConfirm(signedUmi as any)
  return signatureToString(result)
}

/**
 * One wallet transaction to re-lock multiple Owl Nest coins (Owner FreezeDelegate → frozen: true).
 */
export async function batchRelockMplCoreNestAssetsInWallet({
  connection,
  wallet,
  assetIds,
  delegateAddress,
  platformFee,
  sendTransaction,
}: MplCoreFreezeWalletBase & {
  assetIds: string[]
  platformFee?: StakingPlatformFeeUmiTransfer | null
}): Promise<string | null> {
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
  const umi = createNestLockUmi(endpoint, ownerWallet, wallet)
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
        `NFT ${rawId.slice(0, 6)}… has a freeze lock this wallet cannot update. Contact support.`
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

  if (instructionCount === 0 && (platformFee?.lamports ?? 0) <= 0) return null

  if ((platformFee?.lamports ?? 0) > 0) {
    tx = appendStakingPlatformFeeToUmiBuilder(umi, tx, platformFee)
  }

  try {
    return await sendNestLockBuilder({
      umi,
      builder: tx,
      connection,
      wallet,
      sendTransaction,
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (isMplCoreNoApprovalsError(detail)) {
      throw new Error(
        'Collection plugins blocked re-locking your NFTs (Metaplex error 0x1a). Contact support with your wallet address.'
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
  platformFee,
  sendTransaction,
}: AddMplCoreFreezeDelegateArgs & { platformFee?: StakingPlatformFeeUmiTransfer | null }): Promise<string | null> {
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
  const umi = createNestLockUmi(endpoint, ownerWallet, wallet)
  const asset = publicKey(assetId)
  const delegatePublicKey = publicKey(delegate)
  const assetAccount: any = await fetchAsset(umi as any, asset)

  const sendFeeOnlyIfNeeded = async (): Promise<string | null> => {
    if ((platformFee?.lamports ?? 0) <= 0) return null
    let tx = transactionBuilder()
    tx = appendStakingPlatformFeeToUmiBuilder(umi, tx, platformFee)
    return await sendNestLockBuilder({
      umi,
      builder: tx,
      connection,
      wallet,
      sendTransaction,
    })
  }

  if (isMplCoreNestingLockHeld({ asset: assetAccount, nestingDelegateAddress: delegate, ownerWallet })) {
    return await sendFeeOnlyIfNeeded()
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
    return await sendFeeOnlyIfNeeded()
  }

  if (existing && !needsRelock) {
    throw new Error(
      'This NFT has a freeze lock controlled by a different authority. Contact Owltopia support with the mint address.'
    )
  }

  try {
    let builder = existing
      ? updatePlugin(umi as any, {
          ...ixBase,
          plugin: { type: 'FreezeDelegate', frozen: true },
        } as any)
      : addPlugin(umi as any, {
          ...ixBase,
          plugin: mplCoreFreezeDelegatePlugin(delegatePublicKey),
        } as any)

    if ((platformFee?.lamports ?? 0) > 0) {
      builder = appendStakingPlatformFeeToUmiBuilder(umi, builder, platformFee)
    }

    return await sendNestLockBuilder({
      umi,
      builder,
      connection,
      wallet,
      sendTransaction,
    })
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (isMplCoreNoApprovalsError(detail)) {
      throw new Error(
        'This NFT has collection plugins that blocked updating the nest lock (Metaplex error 0x1a). ' +
          'Confirm it is not listed for sale, or contact Owltopia support with the mint address.'
      )
    }
    throw e
  }
}
