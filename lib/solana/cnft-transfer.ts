'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import { getAssetWithProof, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum'
import { buildBubblegumLeafTransferBuilder } from '@/lib/solana/bubblegum-leaf-transfer'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'

interface TransferCompressedNftToEscrowArgs {
  connection: Connection
  // Wallet adapter instance from useWallet().wallet
   
  wallet: any
  assetId: string
  escrowAddress: string
}

export async function transferCompressedNftToEscrow({
  connection,
  wallet,
  assetId,
  escrowAddress,
}: TransferCompressedNftToEscrowArgs): Promise<string> {
  const owner = wallet?.publicKey ?? wallet?.adapter?.publicKey
  if (!owner) {
    throw new Error('Wallet not ready for compressed NFT transfer')
  }

  // DAS + proof APIs require an indexer RPC (e.g. Helius). The wallet Connection may use a
  // read-only public RPC without DAS (see NEXT_PUBLIC_WALLET_READ_RPC_URL).
  const endpoint = resolveMetaplexClientRpcUrl(connection)

  // Build Umi with wallet signer + DAS + Bubblegum plugins.
   
  const umi: any = (createUmi as any)(endpoint)
    .use(walletAdapterIdentity(wallet as any))
    .use(dasApi())
    .use(mplBubblegum())

  const asset = await getAssetWithProof(umi, publicKey(assetId), { truncateCanopy: true })
  const ownerPk = publicKey(owner.toBase58())
  if (asset.leafOwner !== ownerPk) {
    throw new Error('Connected wallet does not own this compressed NFT')
  }

  const builder = await buildBubblegumLeafTransferBuilder(
    umi,
    umi.identity,
    ownerPk,
    publicKey(escrowAddress),
    asset
  )

   
  const result: any = await builder.sendAndConfirm(umi)
  return String(result.signature ?? result)
}

