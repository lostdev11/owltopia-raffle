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
import { sendPreparedVersionedTransactionBase64 } from '@/lib/solana/send-prepared-versioned-tx'
import type { PreparedMplCoreTransfer } from '@/lib/solana/mpl-core-transfer-prepare'
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
import { isOwlSendRpcNetworkError } from '@/lib/owl-send/rpc-network-error'

async function prepareCoreTransferViaServer(params: {
  ownerWallet: string
  mint: string
  recipient: string
  feeDiscountBps?: number
}): Promise<PreparedMplCoreTransfer | null> {
  try {
    const res = await fetch('/api/owl-send/prepare-core-transfer', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-connected-wallet': params.ownerWallet,
      },
      body: JSON.stringify({
        mint: params.mint,
        recipient: params.recipient,
        feeDiscountBps: params.feeDiscountBps ?? 0,
      }),
    })
    const data = (await res.json().catch(() => null)) as {
      item?: PreparedMplCoreTransfer
      error?: string
    } | null
    if (!res.ok || !data?.item) return null
    return data.item
  } catch {
    return null
  }
}

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
  ownerWallet: string
  feeDiscountBps?: number
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
    ownerWallet,
    feeDiscountBps,
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
    // Prefer server-built transfer (private RPC) — browser fetchAsset often NetworkErrors.
    const prepared = await prepareCoreTransferViaServer({
      ownerWallet,
      mint,
      recipient,
      feeDiscountBps,
    })
    if (prepared?.status === 'blocked') {
      if (prepared.reason === 'owner_frozen') {
        throw new Error(OWL_SEND_CORE_OWNER_FREEZE_ERROR)
      }
      if (prepared.reason === 'other_frozen') {
        throw new Error(
          'This Metaplex Core NFT is still frozen on-chain. Unnest / thaw the lock on Nesting first, then Retry.'
        )
      }
      if (prepared.reason === 'not_owner') {
        throw new Error('This NFT is not in the connected wallet.')
      }
      // not_core → fall through to client transfer (will fail similarly) then other kinds
    }
    if (prepared?.status === 'ready') {
      return sendPreparedVersionedTransactionBase64({
        serializedBase64: prepared.serializedBase64,
        connection,
        sendTransaction,
        blockhash: prepared.blockhash,
        lastValidBlockHeight: prepared.lastValidBlockHeight,
        failMessagePrefix: 'Core NFT send would fail on-chain before wallet approval.',
      })
    }
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
  const ownerWallet = owner.toBase58()
  for (const kind of order) {
    let attempts = kind === 'mpl_core' ? 3 : 1
    let lastMsg = ''
    for (let attempt = 0; attempt < attempts; attempt++) {
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
          ownerWallet,
          feeDiscountBps: params.feeDiscountBps,
        })
        onPhase?.('confirming')
        return { ok: true, signature, newAtaCount: 0 }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        lastMsg = msg
        // Retry Core on transient browser RPC flakes before falling through to TM noise.
        if (
          kind === 'mpl_core' &&
          isOwlSendRpcNetworkError(msg) &&
          attempt < attempts - 1
        ) {
          await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
          continue
        }
        if (msg.trim()) errors.push(`${kind}: ${msg}`)
        // If Core transfer failed because the asset is still nest-frozen, stop — later
        // compressed / Token Metadata attempts only add Incorrect-account-owner noise.
        if (
          kind === 'mpl_core' &&
          /frozen|freezedelegate|freeze delegate|noapprovals|0x1a/i.test(msg)
        ) {
          attempts = 0
          break
        }
        // Known Core + RPC death: don't spam compressed/TM with misleading errors.
        if (
          kind === 'mpl_core' &&
          isDasMplCoreInterface(line.interface) &&
          isOwlSendRpcNetworkError(msg)
        ) {
          attempts = 0
          break
        }
        break
      }
    }
    void lastMsg
  }

  // Last resort: if asset already moved somehow, don't charge; otherwise surface error.
  void owner
  void sendFeeOnlyTx
  const best = pickOwlSendSpecialNftError(errors)
  const rpcOnly =
    errors.length > 0 && errors.every((e) => isOwlSendRpcNetworkError(e))
  if (rpcOnly || (best && isOwlSendRpcNetworkError(best))) {
    return {
      ok: false,
      error:
        'Could not reach Solana RPC to prepare this Core NFT send. Tap Retry — Owltopia builds the transfer on the server RPC when you are signed in. If it keeps failing, switch WiFi/mobile data or pause VPN.',
      failedMints: [mint],
    }
  }
  const detail = best ? ` (${best})` : ''
  return {
    ok: false,
    error:
      `Could not send this NFT (tried ${order.join(', ')}).${detail}`.trim() ||
      'Could not send this NFT (tried Token Metadata, Core, and compressed).',
    failedMints: [mint],
  }
}
