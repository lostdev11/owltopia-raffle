'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import {
  publicKey,
  lamports,
  type Umi,
  type TransactionBuilder,
} from '@metaplex-foundation/umi'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'
import { dasApi } from '@metaplex-foundation/digital-asset-standard-api'
import { getAssetWithProof, mplBubblegum } from '@metaplex-foundation/mpl-bubblegum'
import { transferSol } from '@metaplex-foundation/mpl-toolbox'
import { buildBubblegumLeafTransferBuilder } from '@/lib/solana/bubblegum-leaf-transfer'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'
import {
  sendUmiBuilderViaWalletSignAndSend,
  type WalletSendTransactionFn,
} from '@/lib/solana/send-umi-builder-via-wallet'
import {
  assertPhantomUsesWalletSignAndSend,
  createNoopUmiForPhantomSafeSend,
} from '@/lib/solana/phantom-safe-umi-send'
import { umiSignatureToBase58 } from '@/lib/solana/umi-signature'

interface TransferCompressedNftToEscrowArgs {
  connection: Connection
  // Wallet adapter instance from useWallet().wallet
   
  wallet: any
  assetId: string
  escrowAddress: string
  solMilestoneLamports?: number
  fundsEscrowAddress?: string
  /** Required for Phantom — pass `useSendTransactionForWallet()`. */
  sendTransaction?: WalletSendTransactionFn
}

function appendSolMilestoneToBuilder(
  umi: Pick<Umi, 'identity' | 'programs'>,
  builder: TransactionBuilder,
  solMilestoneLamports: number | undefined,
  fundsEscrowAddress: string | undefined
): TransactionBuilder {
  if (
    !solMilestoneLamports ||
    solMilestoneLamports <= 0 ||
    !fundsEscrowAddress?.trim()
  ) {
    return builder
  }
  return builder.add(
    transferSol(umi, {
      destination: publicKey(fundsEscrowAddress.trim()),
      amount: lamports(Math.round(solMilestoneLamports)),
    })
  )
}

export async function transferCompressedNftToEscrow({
  connection,
  wallet,
  assetId,
  escrowAddress,
  solMilestoneLamports,
  fundsEscrowAddress,
  sendTransaction,
}: TransferCompressedNftToEscrowArgs): Promise<string> {
  const owner = wallet?.publicKey ?? wallet?.adapter?.publicKey
  if (!owner) {
    throw new Error('Wallet not ready for compressed NFT transfer')
  }

  assertPhantomUsesWalletSignAndSend({
    wallet,
    sendTransaction,
    action: 'prize escrow deposit',
  })

  // DAS + proof APIs require an indexer RPC (e.g. Helius). The wallet Connection may use a
  // read-only public RPC without DAS (see NEXT_PUBLIC_WALLET_READ_RPC_URL).
  const endpoint = resolveMetaplexClientRpcUrl(connection)
  const ownerBase58 = typeof owner === 'string' ? owner : owner.toBase58()

  // Build Umi with noop (signAndSend) or wallet identity + DAS + Bubblegum.
   
  const umi: any = sendTransaction
    ? (createNoopUmiForPhantomSafeSend(endpoint, ownerBase58) as any)
        .use(dasApi())
        .use(mplBubblegum())
    : (createUmi as any)(endpoint)
        .use(walletAdapterIdentity(wallet as any))
        .use(dasApi())
        .use(mplBubblegum())

  const asset = await getAssetWithProof(umi, publicKey(assetId), { truncateCanopy: true })
  const ownerPk = publicKey(ownerBase58)
  if (asset.leafOwner !== ownerPk) {
    throw new Error('Connected wallet does not own this compressed NFT')
  }

  let builder: TransactionBuilder = await buildBubblegumLeafTransferBuilder(
    umi,
    umi.identity,
    ownerPk,
    publicKey(escrowAddress),
    asset
  )
  builder = appendSolMilestoneToBuilder(
    umi,
    builder,
    solMilestoneLamports,
    fundsEscrowAddress
  )

  if (sendTransaction) {
    return sendUmiBuilderViaWalletSignAndSend({
      umi: umi as Umi,
      builder,
      connection,
      sendTransaction,
    })
  }

   
  const result: any = await builder.sendAndConfirm(umi)
  return umiSignatureToBase58(result)
}
