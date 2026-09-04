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
import {
  OWL_SEND_CONFIRM_TIMEOUT_HINT,
  OWL_SEND_CONFIRM_TIMEOUT_MS,
} from '@/lib/owl-send/confirm'
import { getOwlSendFeeLamportsForCount } from '@/lib/owl-send/fee'
import type { OwlSendLine } from '@/lib/owl-send/batch'
import type { OwlSendBatchResult, OwlSendSendPhase } from '@/lib/owl-send/send-spl-nft-batch'
import {
  isDasMplCoreInterface,
  orderedEscrowFallbacks,
  type EscrowFallbackKind,
} from '@/lib/solana/prize-nft-standard'
import {
  OWL_SEND_CORE_OWNER_FREEZE_ERROR,
  pickOwlSendSpecialNftError,
} from '@/lib/owl-send/mpl-core-owner-freeze'
import { readOwlSendCoreOwnerFreeze } from '@/lib/owl-send/mpl-core-owner-freeze-read'

async function sendFeeOnlyTx(params: {
  connection: Connection
  owner: PublicKey
  sendTransaction: WalletSendTransactionFn
  feeDiscountBps?: number
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlSendFeeLamportsForCount(1, params.feeDiscountBps ?? 0)
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

async function tryFallbackKind(params: {
  kind: EscrowFallbackKind
  connection: Connection
  walletAdapter: WalletAdapter
  sendTransaction: WalletSendTransactionFn
  mint: string
  recipient: string
  feeLamports: number
  treasury: string | null
}): Promise<string> {
  const {
    kind,
    connection,
    walletAdapter,
    sendTransaction,
    mint,
    recipient,
    feeLamports,
    treasury,
  } = params
  const feeOpts =
    feeLamports > 0 && treasury
      ? {
          solMilestoneLamports: feeLamports,
          fundsEscrowAddress: treasury,
        }
      : {}

  if (kind === 'compressed') {
    return transferCompressedNftToEscrow({
      connection,
      wallet: walletAdapter,
      assetId: mint,
      escrowAddress: recipient,
      sendTransaction,
      ...feeOpts,
    })
  }
  if (kind === 'mpl_core') {
    return transferMplCoreToEscrow({
      connection,
      wallet: walletAdapter,
      assetId: mint,
      escrowAddress: recipient,
      sendTransaction,
      ...feeOpts,
    })
  }
  return transferTokenMetadataNftToEscrow({
    connection,
    wallet: walletAdapter,
    mintAddress: mint,
    escrowAddress: recipient,
    sendTransaction,
    ...feeOpts,
  })
}

/**
 * Try DAS-ordered fallbacks (cNFT → … or TM → …) with Owl fee in the same approval when possible.
 */
export async function sendOwlSendSpecialNft(params: {
  connection: Connection
  owner: PublicKey
  walletAdapter: WalletAdapter | null
  sendTransaction: WalletSendTransactionFn
  line: OwlSendLine
  onPhase?: (phase: OwlSendSendPhase) => void
  /** Owltopia holder discount (bps). */
  feeDiscountBps?: number
}): Promise<OwlSendBatchResult> {
  const { connection, owner, walletAdapter, sendTransaction, line, onPhase } = params
  const recipient = line.recipient.trim()
  const mint = line.mint.trim()
  const treasury = getPlatformFeeTreasuryWalletAddressClient()
  const feeLamports = getOwlSendFeeLamportsForCount(1, params.feeDiscountBps ?? 0)

  if (!walletAdapter) {
    return { ok: false, error: 'Wallet adapter not ready for this NFT type.', failedMints: [mint] }
  }

  onPhase?.('building')

  // Admin force-leave leaves Owner FreezeDelegate frozen on-chain. Detect before Core
  // transfer so we don't fall through to Token Metadata → misleading "Incorrect account owner".
  if (isDasMplCoreInterface(line.interface) || line.interface == null || line.interface === '') {
    const freeze = await readOwlSendCoreOwnerFreeze({
      connection,
      assetId: mint,
      // Only skip when DAS clearly said non-Core; unknown/null still probes.
      interfaceHint: isDasMplCoreInterface(line.interface) ? line.interface : null,
    })
    if (freeze.kind === 'owner_frozen') {
      return {
        ok: false,
        error: OWL_SEND_CORE_OWNER_FREEZE_ERROR,
        failedMints: [mint],
      }
    }
    if (freeze.kind === 'other_frozen') {
      return {
        ok: false,
        error:
          'This Metaplex Core NFT is still frozen on-chain. Unnest / thaw the lock on Nesting first, then Retry.',
        failedMints: [mint],
      }
    }
  }

  onPhase?.('approving')

  const order = orderedEscrowFallbacks({
    compressed: line.compressed,
    interface: line.interface,
  })

  const errors: string[] = []
  for (const kind of order) {
    try {
      const signature = await tryFallbackKind({
        kind,
        connection,
        walletAdapter,
        sendTransaction,
        mint,
        recipient,
        feeLamports,
        treasury,
      })
      onPhase?.('confirming')
      return { ok: true, signature, newAtaCount: 0 }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg.trim()) errors.push(`${kind}: ${msg}`)
      // If Core transfer failed because the asset is still nest-frozen, stop — later
      // compressed / Token Metadata attempts only add Incorrect-account-owner noise.
      if (
        kind === 'mpl_core' &&
        /frozen|freezedelegate|freeze delegate|noapprovals|0x1a/i.test(msg)
      ) {
        break
      }
    }
  }

  // Last resort: if asset already moved somehow, don't charge; otherwise surface error.
  void owner
  void sendFeeOnlyTx
  const best = pickOwlSendSpecialNftError(errors)
  const detail = best ? ` (${best})` : ''
  return {
    ok: false,
    error:
      `Could not send this NFT (tried ${order.join(', ')}).${detail}`.trim() ||
      'Could not send this NFT (tried Token Metadata, Core, and compressed).',
    failedMints: [mint],
  }
}
