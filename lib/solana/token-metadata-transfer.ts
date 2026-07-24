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
import { transferSol } from '@metaplex-foundation/mpl-toolbox'
import {
  sendUmiBuilderViaWalletSignAndSend,
  type WalletSendTransactionFn,
} from '@/lib/solana/send-umi-builder-via-wallet'
import {
  assertPhantomUsesWalletSignAndSend,
  createNoopUmiForPhantomSafeSend,
} from '@/lib/solana/phantom-safe-umi-send'
import { umiSignatureToBase58 } from '@/lib/solana/umi-signature'
import { resolveMetaplexClientRpcUrl } from '@/lib/solana-rpc-url'

interface TransferTokenMetadataNftToEscrowArgs {
  connection: Connection
  // Wallet adapter instance from useWallet().wallet?.adapter
   
  wallet: any
  mintAddress: string
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

/**
 * Transfer classic Token Metadata NFTs (including many pNFT cases) to escrow.
 * We try NonFungible first, then ProgrammableNonFungible.
 */
export async function transferTokenMetadataNftToEscrow({
  connection,
  wallet,
  mintAddress,
  escrowAddress,
  solMilestoneLamports,
  fundsEscrowAddress,
  sendTransaction,
}: TransferTokenMetadataNftToEscrowArgs): Promise<string> {
  const walletPublicKey = wallet?.publicKey ?? wallet?.adapter?.publicKey
  if (!walletPublicKey) {
    throw new Error('Wallet adapter not ready for Token Metadata transfer')
  }

  assertPhantomUsesWalletSignAndSend({
    wallet,
    sendTransaction,
    action: 'prize escrow deposit',
  })

  const endpoint = resolveMetaplexClientRpcUrl(connection)
  const ownerBase58 =
    typeof walletPublicKey === 'string' ? walletPublicKey : walletPublicKey.toBase58()

   
  const tm: any = await import('@metaplex-foundation/mpl-token-metadata')

  const umiBase = sendTransaction
    ? createNoopUmiForPhantomSafeSend(endpoint, ownerBase58)
    : ((createUmi as any)(endpoint).use(walletAdapterIdentity(wallet as any)) as Umi)
   
  const umi: any = (umiBase as any).use(tm.mplTokenMetadata())

  const mint = publicKey(mintAddress)
  const destinationOwner = publicKey(escrowAddress)

  const attempts = [
    { name: 'NonFungible', tokenStandard: tm.TokenStandard.NonFungible },
    {
      name: 'ProgrammableNonFungible',
      tokenStandard: tm.TokenStandard.ProgrammableNonFungible,
    },
  ]

  let lastError: string | null = null
  for (const attempt of attempts) {
    try {
       
      let builder: TransactionBuilder = tm.transferV1(umi as any, {
        mint,
        destinationOwner,
        tokenStandard: attempt.tokenStandard,
      } as any) as TransactionBuilder
      builder = appendSolMilestoneToBuilder(
        umi,
        builder,
        solMilestoneLamports,
        fundsEscrowAddress
      )

      if (sendTransaction) {
        return await sendUmiBuilderViaWalletSignAndSend({
          umi: umi as Umi,
          builder,
          connection,
          sendTransaction,
        })
      }

       
      const result: any = await builder.sendAndConfirm(umi as any)
      return umiSignatureToBase58(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      lastError = `${attempt.name}: ${msg}`
    }
  }

  throw new Error(
    lastError
      ? `Token Metadata transfer failed. ${lastError}`
      : 'Token Metadata transfer failed.'
  )
}
