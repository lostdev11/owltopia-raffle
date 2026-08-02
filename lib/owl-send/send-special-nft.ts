'use client'

/**
 * Single-NFT path for compressed / Metaplex Core / Token Metadata (pNFT) transfers
 * with Owl fee in the same approval when possible.
 */

import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import type { WalletAdapter } from '@solana/wallet-adapter-base'
import { confirmSignatureSuccessOnChain } from '@/lib/solana/confirm-signature-success'
import { transferCompressedNftToEscrow } from '@/lib/solana/cnft-transfer'
import { transferMplCoreToEscrow } from '@/lib/solana/mpl-core-transfer'
import { transferTokenMetadataNftToEscrow } from '@/lib/solana/token-metadata-transfer'
import type { WalletSendTransactionFn } from '@/lib/solana/send-umi-builder-via-wallet'
import { getPlatformFeeTreasuryWalletAddressClient } from '@/lib/solana/platform-fee-treasury-wallet'
import { assertNftTransferable } from '@/lib/owl-send/assert-nft-transferable'
import {
  OWL_SEND_CONFIRM_TIMEOUT_HINT,
  OWL_SEND_CONFIRM_TIMEOUT_MS,
} from '@/lib/owl-send/confirm'
import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import type { OwlSendLine } from '@/lib/owl-send/batch'
import type { OwlSendBatchResult } from '@/lib/owl-send/send-spl-nft-batch'

async function sendFeeOnlyTx(params: {
  connection: Connection
  owner: PublicKey
  sendTransaction: WalletSendTransactionFn
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlSendFeeLamportsForCount(1)
  if (feeLamports <= 0) return { ok: true, signature: '' }
  if (!treasury) {
    return { ok: false, error: 'OwlSend fee treasury is not configured.' }
  }
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: params.owner,
      toPubkey: new PublicKey(treasury),
      lamports: feeLamports,
    })
  )
  try {
    const signature = await params.sendTransaction(tx, params.connection, {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
      maxRetries: 3,
    })
    await confirmSignatureSuccessOnChain(
      params.connection,
      signature,
      OWL_SEND_CONFIRM_TIMEOUT_MS,
      OWL_SEND_CONFIRM_TIMEOUT_HINT
    )
    return { ok: true, signature }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Try TM (with fee via sol milestone to treasury) → Core (fee in-tx) → cNFT (fee in-tx).
 * Fee uses the same `transferSol` append pattern as escrow deposits when the UMI path supports it.
 */
export async function sendOwlSendSpecialNft(params: {
  connection: Connection
  owner: PublicKey
  walletAdapter: WalletAdapter | null
  sendTransaction: WalletSendTransactionFn
  line: OwlSendLine
}): Promise<OwlSendBatchResult> {
  const { connection, owner, walletAdapter, sendTransaction, line } = params
  const recipient = line.recipient.trim()
  const mint = line.mint.trim()
  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlSendFeeLamportsForCount(1)

  if (!walletAdapter) {
    return { ok: false, error: 'Wallet adapter not ready for this NFT type.', failedMints: [mint] }
  }

  // Classic SPL freeze/delegate check when a token account hint exists (nested/staked).
  // Core/cNFT may not have an SPL account — ignore not_held and continue special paths.
  const preflight = await assertNftTransferable({
    connection,
    mint,
    owner,
    tokenAccount: line.tokenAccount,
    name: line.name,
  })
  if (!preflight.ok && (preflight.reason === 'frozen' || preflight.reason === 'delegated')) {
    return { ok: false, error: preflight.error, failedMints: [mint] }
  }

  // Token Metadata / pNFT — append fee as SOL transfer to treasury in the same UMI builder.
  try {
    const signature = await transferTokenMetadataNftToEscrow({
      connection,
      wallet: walletAdapter,
      mintAddress: mint,
      escrowAddress: recipient,
      solMilestoneLamports: feeLamports > 0 ? feeLamports : undefined,
      fundsEscrowAddress: feeLamports > 0 ? treasury ?? undefined : undefined,
      sendTransaction,
    })
    return { ok: true, signature, newAtaCount: 0 }
  } catch {
    /* try Core */
  }

  try {
    const signature = await transferMplCoreToEscrow({
      connection,
      wallet: walletAdapter,
      assetId: mint,
      escrowAddress: recipient,
      solMilestoneLamports: feeLamports > 0 ? feeLamports : undefined,
      fundsEscrowAddress: feeLamports > 0 ? treasury ?? undefined : undefined,
      sendTransaction,
    })
    return { ok: true, signature, newAtaCount: 0 }
  } catch {
    /* try compressed */
  }

  try {
    const signature = await transferCompressedNftToEscrow({
      connection,
      wallet: walletAdapter,
      assetId: mint,
      escrowAddress: recipient,
      solMilestoneLamports: feeLamports > 0 ? feeLamports : undefined,
      fundsEscrowAddress: feeLamports > 0 ? treasury ?? undefined : undefined,
      sendTransaction,
    })
    return { ok: true, signature, newAtaCount: 0 }
  } catch (e) {
    // Last resort: if asset already moved somehow, don't charge; otherwise surface error.
    void owner
    void sendFeeOnlyTx
    const msg = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      error: msg || 'Could not send this NFT (tried Token Metadata, Core, and compressed).',
      failedMints: [mint],
    }
  }
}
