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
import { fetchAsset, transferV1 } from '@metaplex-foundation/mpl-core'
import { transferSol } from '@metaplex-foundation/mpl-toolbox'
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

interface TransferMplCoreToEscrowArgs {
  connection: Connection
  // Wallet adapter instance from useWallet().wallet
  // Typed as any to support different adapter versions.
   
  wallet: any
  assetId: string
  escrowAddress: string
  /** Optional SOL milestone amount (lamports) to funds escrow in the same tx. */
  solMilestoneLamports?: number
  fundsEscrowAddress?: string
  /**
   * Required for Phantom (Blowfish/Lighthouse). Pass `useSendTransactionForWallet()`.
   * Builds an unsigned tx and submits via signAndSendTransaction.
   */
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

export async function transferMplCoreToEscrow({
  connection,
  wallet,
  assetId,
  escrowAddress,
  solMilestoneLamports,
  fundsEscrowAddress,
  sendTransaction,
}: TransferMplCoreToEscrowArgs): Promise<string> {
  const pubkey = wallet.publicKey ?? wallet.adapter?.publicKey
  if (!pubkey) {
    throw new Error('Wallet not ready for Mpl Core transfer')
  }

  assertPhantomUsesWalletSignAndSend({
    wallet,
    sendTransaction,
    action: 'prize escrow deposit',
  })

  const endpoint = resolveMetaplexClientRpcUrl(connection)
  const ownerBase58 = typeof pubkey === 'string' ? pubkey : pubkey.toBase58()

  // Unsigned noop identity when using wallet signAndSend (Phantom Blowfish / Lighthouse).
  // Legacy non-Phantom fallback: walletAdapterIdentity + sendAndConfirm.
  const umi: Umi = sendTransaction
    ? createNoopUmiForPhantomSafeSend(endpoint, ownerBase58)
    : ((createUmi as any)(endpoint).use(walletAdapterIdentity(wallet as any)) as Umi)

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
   
  let builder: TransactionBuilder = transferV1(umi as any, {
    asset,
    newOwner,
    ...(maybeCollection ? { collection: maybeCollection } : {}),
  } as any) as TransactionBuilder

  builder = appendSolMilestoneToBuilder(
    umi,
    builder,
    solMilestoneLamports,
    fundsEscrowAddress
  )

  if (sendTransaction) {
    return sendUmiBuilderViaWalletSignAndSend({
      umi,
      builder,
      connection,
      sendTransaction,
    })
  }

   
  const result: any = await builder.sendAndConfirm(umi as any)
  return umiSignatureToBase58(result)
}
