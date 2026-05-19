'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { addPlugin, fetchAsset, updatePlugin } from '@metaplex-foundation/mpl-core'
import bs58 from 'bs58'
import { isMplCoreNoApprovalsError } from '@/lib/solana/mpl-core-transfer-errors'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'

type AddMplCoreFreezeDelegateArgs = {
  connection: Connection
  wallet: any
  assetId: string
  delegateAddress: string
}

function signatureToString(result: any): string {
  const sig = result?.signature ?? result
  if (sig instanceof Uint8Array) return bs58.encode(sig)
  if (Array.isArray(sig)) return bs58.encode(Uint8Array.from(sig))
  return String(sig)
}

function mplCoreFreezeDelegateMatches(assetAccount: unknown, delegateAddress: string): boolean {
  const asset = assetAccount as {
    freezeDelegate?: { authority?: { address?: unknown }; frozen?: boolean }
  }
  const authority = asset?.freezeDelegate?.authority as { address?: unknown } | undefined
  if (!authority || !delegateAddress.trim()) return false
  const address = (authority as { address?: unknown }).address
  return Boolean(address) && String(address) === delegateAddress.trim()
}

function hasMplCoreFreezeDelegate(assetAccount: unknown): boolean {
  return Boolean((assetAccount as { freezeDelegate?: unknown })?.freezeDelegate)
}

function mplCoreFreezeDelegatePlugin(delegatePublicKey: ReturnType<typeof publicKey>) {
  return {
    type: 'FreezeDelegate' as const,
    frozen: true,
    authority: { type: 'Address' as const, address: delegatePublicKey },
  }
}

/**
 * Owner-signed MPL Core FreezeDelegate setup.
 * Returns `null` when the nesting freeze delegate is already on the asset (server re-freezes if thawed).
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
  const delegate = delegateAddress.trim()
  if (!delegate) {
    throw new Error('Freeze delegate address is not configured.')
  }

  const endpoint = resolveMetaplexClientRpcUrl(connection)
  const umi: any = (createUmi as any)(endpoint).use(walletAdapterIdentity(wallet as any))
  const asset = publicKey(assetId)
  const delegatePublicKey = publicKey(delegate)
  const assetAccount: any = await fetchAsset(umi as any, asset)
  // Thawed re-nests still have the delegate plugin — skip wallet tx; /api/me/staking/freeze re-freezes.
  if (mplCoreFreezeDelegateMatches(assetAccount, delegate)) {
    return null
  }
  const maybeCollection: any =
    assetAccount?.updateAuthority?.type === 'Collection'
      ? assetAccount.updateAuthority.address
      : undefined

  const plugin = mplCoreFreezeDelegatePlugin(delegatePublicKey)
  const ixArgs = {
    asset,
    ...(maybeCollection ? { collection: maybeCollection } : {}),
    plugin,
  }

  try {
    const builder = hasMplCoreFreezeDelegate(assetAccount)
      ? updatePlugin(umi as any, ixArgs as any)
      : addPlugin(umi as any, ixArgs as any)
    const result = await builder.sendAndConfirm(umi as any)
    return signatureToString(result)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    if (isMplCoreNoApprovalsError(detail)) {
      throw new Error(
        'This Owltopia coin has collection plugins that blocked updating the nest lock (Metaplex error 0x1a). ' +
          'That often happens when a previous nest left a freeze plugin or the collection requires extra approvals. ' +
          'Try closing any old nest first, or contact Owltopia support with the coin mint address.'
      )
    }
    throw e
  }
}
