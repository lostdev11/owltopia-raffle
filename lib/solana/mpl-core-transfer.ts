'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { fetchAsset, transferV1 } from '@metaplex-foundation/mpl-core'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'

interface TransferMplCoreToEscrowArgs {
  connection: Connection
  // Wallet adapter instance from useWallet().wallet
  // Typed as any to support different adapter versions.
   
  wallet: any
  assetId: string
  escrowAddress: string
}

export async function transferMplCoreToEscrow({
  connection,
  wallet,
  assetId,
  escrowAddress,
}: TransferMplCoreToEscrowArgs): Promise<string> {
  const pubkey = wallet.publicKey ?? wallet.adapter?.publicKey
  if (!pubkey) {
    throw new Error('Wallet not ready for Mpl Core transfer')
  }

  const endpoint = resolveMetaplexClientRpcUrl(connection)

  // createUmi has multiple overloads; use any to avoid version-specific type errors.
   
  const umi: any = (createUmi as any)(endpoint).use(walletAdapterIdentity(wallet as any))

  const asset = publicKey(assetId)
  const newOwner = publicKey(escrowAddress)
  // Mpl Core assets in a collection must pass `collection` for transfer.
  // Otherwise the program throws "Missing collection" (custom error 0x19).
   
  const assetAccount: any = await fetchAsset(umi as any, asset)
   
  const maybeCollection: any =
    assetAccount?.updateAuthority?.type === 'Collection'
      ? assetAccount.updateAuthority.address
      : undefined

  // Use TransactionBuilder API directly; types in kinobi are stricter than we need here.
   
  const builder: any = transferV1(umi as any, {
    asset,
    newOwner,
    ...(maybeCollection ? { collection: maybeCollection } : {}),
  } as any)

   
  const result: any = await builder.sendAndConfirm(umi as any)
  return String(result.signature ?? result)
}


