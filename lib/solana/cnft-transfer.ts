'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import { getAssetWithProof, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum'
import { buildBubblegumLeafTransferBuilder } from '@/lib/solana/bubblegum-leaf-transfer'

interface TransferCompressedNftToEscrowArgs {
  connection: Connection
  // Wallet adapter instance from useWallet().wallet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  const endpoint =
    // rpcEndpoint is available on recent web3.js; fall back to internal field if needed.
    (connection as any).rpcEndpoint || (connection as any)._rpcEndpoint

  // Build Umi with wallet signer + DAS + Bubblegum plugins.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await builder.sendAndConfirm(umi)
  return String(result.signature ?? result)
}

