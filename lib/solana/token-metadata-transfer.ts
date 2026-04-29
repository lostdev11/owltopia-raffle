'use client'

import type { Connection } from '@solana/web3.js'
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults'
import { publicKey } from '@metaplex-foundation/umi'
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters'

interface TransferTokenMetadataNftToEscrowArgs {
  connection: Connection
  // Wallet adapter instance from useWallet().wallet?.adapter
   
  wallet: any
  mintAddress: string
  escrowAddress: string
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
}: TransferTokenMetadataNftToEscrowArgs): Promise<string> {
  const walletPublicKey = wallet?.publicKey ?? wallet?.adapter?.publicKey
  if (!walletPublicKey) {
    throw new Error('Wallet adapter not ready for Token Metadata transfer')
  }

  const endpoint =
    // rpcEndpoint is available on recent web3.js; fall back to internal field if needed.
     
    (connection as any).rpcEndpoint || (connection as any)._rpcEndpoint

  // Dynamic import keeps this isolated and avoids hard coupling at module init time.
   
  const tm: any = await import('@metaplex-foundation/mpl-token-metadata')

   
  const umi: any = (createUmi as any)(endpoint)
    .use(walletAdapterIdentity(wallet as any))
    .use(tm.mplTokenMetadata())

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
       
      const builder: any = tm.transferV1(umi as any, {
        mint,
        destinationOwner,
        tokenStandard: attempt.tokenStandard,
      } as any)
       
      const result: any = await builder.sendAndConfirm(umi as any)
      return String(result.signature ?? result)
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

