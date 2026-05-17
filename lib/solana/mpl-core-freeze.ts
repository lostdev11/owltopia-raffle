'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { addPlugin, fetchAsset } from '@metaplex-foundation/mpl-core'
import bs58 from 'bs58'
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

/**
 * Owner-signed MPL Core FreezeDelegate setup.
 * The owner wallet adds a FreezeDelegate plugin whose authority is the server-side delegate.
 */
export async function addMplCoreFreezeDelegate({
  connection,
  wallet,
  assetId,
  delegateAddress,
}: AddMplCoreFreezeDelegateArgs): Promise<string> {
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
  const maybeCollection: any =
    assetAccount?.updateAuthority?.type === 'Collection'
      ? assetAccount.updateAuthority.address
      : undefined

  const result = await addPlugin(umi as any, {
    asset,
    ...(maybeCollection ? { collection: maybeCollection } : {}),
    plugin: {
      type: 'FreezeDelegate',
      frozen: true,
      authority: { type: 'Address', address: delegatePublicKey },
    },
  } as any).sendAndConfirm(umi as any)

  return signatureToString(result)
}
