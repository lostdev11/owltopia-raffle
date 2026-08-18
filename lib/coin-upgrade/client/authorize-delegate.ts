'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  createNoopSigner,
  publicKey,
  signerIdentity,
} from '@metaplex-foundation/umi'
import { fetchCollection, mplCore, updateCollectionPlugin } from '@metaplex-foundation/mpl-core'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'
import {
  assertPhantomUsesWalletSignAndSend,
} from '@/lib/solana/phantom-safe-umi-send'
import {
  sendUmiBuilderViaWalletSignAndSend,
  type WalletSendTransactionFn,
} from '@/lib/solana/send-umi-builder-via-wallet'

/**
 * Gembird signs once in Phantom: add the server hot key to the coin collection's
 * UpdateDelegate.additionalDelegates (keeps any existing delegates).
 */
export async function authorizeCoinArtUpgradeDelegateInWallet(params: {
  connection: Connection
  wallet: unknown
  ownerWallet: string
  collectionAddress: string
  hotWallet: string
  sendTransaction: WalletSendTransactionFn
}): Promise<{ signature: string; alreadyAuthorized: boolean }> {
  const ownerWallet = params.ownerWallet.trim()
  const hotWallet = params.hotWallet.trim()
  const collectionAddress = params.collectionAddress.trim()
  if (!ownerWallet || !hotWallet || !collectionAddress) {
    throw new Error('Missing wallet, hot key, or collection address.')
  }

  assertPhantomUsesWalletSignAndSend({
    wallet: params.wallet,
    sendTransaction: params.sendTransaction,
    action: 'coin art upgrade authorize',
  })

  const endpoint = resolveMetaplexClientRpcUrl(params.connection)
  const umi = createUmi(endpoint)
    .use(mplCore())
    .use(signerIdentity(createNoopSigner(publicKey(ownerWallet))))

  const collection = await fetchCollection(umi, publicKey(collectionAddress))
  const onChainAuthority = String(collection.updateAuthority)
  if (onChainAuthority !== ownerWallet) {
    throw new Error(
      `Connected wallet is not the coin collection update authority (${onChainAuthority.slice(0, 4)}…${onChainAuthority.slice(-4)}). Switch to that wallet in Phantom.`
    )
  }

  const existing = (collection.updateDelegate?.additionalDelegates ?? []).map(String)
  if (existing.includes(hotWallet)) {
    return { signature: '', alreadyAuthorized: true }
  }

  const nextDelegates = [...existing, hotWallet]
  const builder = updateCollectionPlugin(umi, {
    collection: collection.publicKey,
    plugin: {
      type: 'UpdateDelegate',
      additionalDelegates: nextDelegates.map((d) => publicKey(d)),
    },
  })

  const signature = await sendUmiBuilderViaWalletSignAndSend({
    umi,
    builder,
    connection: params.connection,
    sendTransaction: params.sendTransaction,
  })

  return { signature, alreadyAuthorized: false }
}
